#!/usr/bin/env python3
"""Plan and execute a one-shot migration into the current INSU Player contract."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import shutil
import sqlite3
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable


PLAN_SCHEMA_VERSION = 1
BUNDLE_SCHEMA_VERSION = 1
MIGRATION_DIRECTORY = ".insu-player-migrations"
BUNDLE_FILENAME = ".insu-player-migration-input.json"
DATABASE_FILES = ("app.db", "app.db-wal", "app.db-shm")
SESSION_FILES = (
    ".insu-player-server.json",
    ".insu-player-server.pid",
    ".insu-provider-session.json",
)
EPHEMERAL_DIRECTORIES = (
    ".agent-tools/insu-player/tmp/cookie-sessions",
    ".agent-tools/insu-player/tmp/imports",
)

# These tables contain durable user-facing data. They may be copied only when
# the complete SQLite shape already matches the current schema, or replaced by
# an explicit current-shape transform bundle prepared by the Agent.
DURABLE_TABLES = (
    "active_subtitle_tracks",
    "active_summary_artifacts",
    "job_assets",
    "job_history",
    "media_items",
    "media_renditions",
    "media_sources",
    "note_anchors",
    "notes",
    "playback_states",
    "subtitle_artifact_dependencies",
    "subtitle_artifact_tracks",
    "subtitle_artifacts",
    "subtitle_style_presets",
    "subtitle_style_settings",
    "summary_artifacts",
    "summary_dependencies",
    "tag_assignments",
    "tags",
    "transcription_settings",
)

# These rows are runtime, credential-adjacent, resumable, or safely rebuilt.
# They are intentionally never migrated, even when their SQL shape matches.
EPHEMERAL_TABLES = (
    "agent_intents",
    "download_queue_items",
    "download_queue_settings",
    "extension_pairing_invitations",
    "extension_pairings",
    "local_media_imports",
    "local_model_download_runs",
    "media_download_runs",
    "operation_events",
    "operations",
    "runtime_capabilities",
    "subtitle_pipelines",
    "subtitle_runs",
)
REBUILDABLE_BOOTSTRAP_TABLES = {
    "download_queue_settings",
    "runtime_capabilities",
}

DERIVED_ARTIFACT_TRANSFORM_TABLES = (
    "active_subtitle_tracks",
    "active_summary_artifacts",
    "media_items",
    "note_anchors",
    "subtitle_artifact_dependencies",
    "subtitle_artifact_tracks",
    "subtitle_artifacts",
    "summary_artifacts",
    "summary_dependencies",
    "tag_assignments",
)

MEDIA_RECORD_FIELDS = {
    "schemaVersion",
    "videoId",
    "title",
    "sourceUrl",
    "sourceKind",
    "durationSeconds",
    "state",
    "stage",
    "progress",
    "message",
    "assets",
    "subtitleArtifacts",
    "activeSubtitleTracks",
    "subtitlePipeline",
    "transcription",
    "process",
    "lastError",
    "createdAt",
    "updatedAt",
    "completedAt",
    "history",
}


class MigrationError(RuntimeError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def json_scalar(value: object) -> object:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise MigrationError("database contains a non-finite numeric value")
        return value
    if isinstance(value, bytes):
        raise MigrationError("transform bundles do not support BLOB columns")
    raise MigrationError(f"unsupported SQLite value type: {type(value).__name__}")


def process_is_alive(pid: object) -> bool:
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def watch_skill_root() -> Path:
    return skill_root().parent / "watch-video"


def current_schema_path() -> Path:
    return watch_skill_root() / "assets" / "server" / "current-schema.sql"


def load_job_state_module() -> ModuleType:
    path = watch_skill_root() / "scripts" / "job_state.py"
    specification = importlib.util.spec_from_file_location("insu_current_job_state", path)
    if specification is None or specification.loader is None:
        raise MigrationError(f"cannot load current job contract: {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def load_python_module(path: Path, name: str) -> ModuleType:
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise MigrationError(f"cannot load current validator: {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def current_contract() -> dict[str, int]:
    module = load_job_state_module()
    return {
        "applicationId": int(module.DATABASE_APPLICATION_ID),
        "dataSchemaVersion": int(module.DATABASE_SCHEMA_VERSION),
        "mediaRecordSchemaVersion": int(module.SCHEMA_VERSION),
    }


def resolve_scope(project_root_input: str, workspace_input: str) -> tuple[Path, Path]:
    project_root = Path(project_root_input).expanduser().resolve()
    if not project_root.is_dir() or project_root == Path(project_root.anchor):
        raise MigrationError(f"project root is invalid: {project_root}")
    if project_root == Path.home():
        raise MigrationError("project root must not be the home directory")
    expected_workspace = project_root / ".local" / "insu-player"
    if expected_workspace.is_symlink():
        raise MigrationError(f"workspace must not be a symlink: {expected_workspace}")
    workspace = Path(workspace_input).expanduser().resolve()
    if workspace != expected_workspace.resolve():
        raise MigrationError(
            "workspace must be the current project's exact .local/insu-player directory"
        )
    if not workspace.is_dir():
        raise MigrationError(f"workspace not found: {workspace}")
    jobs = workspace / "jobs"
    if not jobs.is_dir() or jobs.is_symlink():
        raise MigrationError(f"workspace jobs directory is missing or unsafe: {jobs}")
    database = workspace / "app.db"
    if not database.is_file() or database.is_symlink():
        raise MigrationError(f"source database is missing or unsafe: {database}")
    return project_root, workspace


def open_readonly_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def table_names(connection: sqlite3.Connection) -> list[str]:
    return sorted(
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_schema "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    )


def table_shape(connection: sqlite3.Connection, table: str) -> list[dict[str, object]]:
    rows = connection.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
    return [
        {
            "name": str(row[1]),
            "type": str(row[2]).lower(),
            "notNull": bool(row[3]),
            "default": row[4],
            "primaryKey": int(row[5]),
        }
        for row in rows
    ]


def table_count(connection: sqlite3.Connection, table: str) -> int:
    return int(
        connection.execute(
            f"SELECT COUNT(*) FROM {quote_identifier(table)}"
        ).fetchone()[0]
    )


def database_digest(connection: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    header = {
        "applicationId": int(connection.execute("PRAGMA application_id").fetchone()[0]),
        "userVersion": int(connection.execute("PRAGMA user_version").fetchone()[0]),
    }
    digest.update(canonical_json(header).encode("utf-8"))
    for table in table_names(connection):
        shape = table_shape(connection, table)
        columns = [str(column["name"]) for column in shape]
        primary = [
            (int(column["primaryKey"]), str(column["name"]))
            for column in shape
            if int(column["primaryKey"]) > 0
        ]
        order_columns = [name for _, name in sorted(primary)] or columns
        select_columns = ", ".join(quote_identifier(column) for column in columns)
        order_clause = ", ".join(quote_identifier(column) for column in order_columns)
        digest.update(canonical_json({"table": table, "shape": shape}).encode("utf-8"))
        cursor = connection.execute(
            f"SELECT {select_columns} FROM {quote_identifier(table)} ORDER BY {order_clause}"
        )
        while True:
            rows = cursor.fetchmany(256)
            if not rows:
                break
            for row in rows:
                digest.update(
                    canonical_json([json_scalar(value) for value in row]).encode("utf-8")
                )
    return digest.hexdigest()


def build_current_database(path: Path, contract: dict[str, int]) -> sqlite3.Connection:
    if path.exists():
        raise MigrationError(f"refusing to overwrite staging database: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(current_schema_path().read_text(encoding="utf-8"))
        connection.execute(f"PRAGMA application_id = {contract['applicationId']}")
        connection.execute(f"PRAGMA user_version = {contract['dataSchemaVersion']}")
        connection.commit()
    except Exception:
        connection.close()
        if path.is_file():
            path.unlink()
        raise
    return connection


def current_schema_inventory(contract: dict[str, int]) -> dict[str, Any]:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.executescript(current_schema_path().read_text(encoding="utf-8"))
        tables = table_names(connection)
        return {
            "tables": tables,
            "shapes": {table: table_shape(connection, table) for table in tables},
            "schemaSha256": hashlib.sha256(current_schema_path().read_bytes()).hexdigest(),
            **contract,
        }
    finally:
        connection.close()


def inspect_jobs(workspace: Path) -> dict[str, Any]:
    jobs = workspace / "jobs"
    digest = hashlib.sha256()
    unsafe: list[str] = []
    job_ids: list[str] = []
    file_count = 0
    total_bytes = 0
    for current, directories, files in os.walk(jobs, topdown=True, followlinks=False):
        current_path = Path(current)
        directories.sort()
        files.sort()
        safe_directories: list[str] = []
        for name in directories:
            candidate = current_path / name
            relative = candidate.relative_to(workspace).as_posix()
            if candidate.is_symlink():
                unsafe.append(relative)
                continue
            if current_path == jobs:
                job_ids.append(name)
            digest.update(canonical_json([relative, "directory"]).encode("utf-8"))
            safe_directories.append(name)
        directories[:] = safe_directories
        for name in files:
            candidate = current_path / name
            relative = candidate.relative_to(workspace).as_posix()
            if candidate.is_symlink() or not candidate.is_file():
                unsafe.append(relative)
                continue
            stat = candidate.lstat()
            file_count += 1
            total_bytes += stat.st_size
            digest.update(
                canonical_json(
                    [relative, "file", stat.st_size, stat.st_mtime_ns]
                ).encode("utf-8")
            )
    return {
        "jobIds": sorted(job_ids),
        "jobCount": len(job_ids),
        "files": file_count,
        "bytes": total_bytes,
        "fingerprint": digest.hexdigest(),
        "unsafeEntries": sorted(unsafe),
    }


def inspect_server(workspace: Path) -> dict[str, Any]:
    descriptor = load_json(workspace / ".insu-player-server.json") or {}
    pid: object = descriptor.get("pid")
    if not isinstance(pid, int):
        try:
            pid = int((workspace / ".insu-player-server.pid").read_text().strip())
        except (OSError, ValueError):
            pid = None
    return {"pid": pid if isinstance(pid, int) else None, "alive": process_is_alive(pid)}


def ephemeral_filesystem_blockers(workspace: Path) -> list[dict[str, str]]:
    blocked: list[dict[str, str]] = []
    for relative in SESSION_FILES:
        candidate = workspace / relative
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
            blocked.append({"code": "unsafe-session-target", "path": relative})
    for relative in EPHEMERAL_DIRECTORIES:
        candidate = workspace / relative
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            blocked.append({"code": "unsafe-session-target", "path": relative})
    return blocked


def clear_ephemeral_filesystem(workspace: Path) -> dict[str, list[str]]:
    removed_files: list[str] = []
    cleared_directories: list[str] = []
    for relative in SESSION_FILES:
        candidate = workspace / relative
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
            raise MigrationError(f"session target became unsafe after preview: {candidate}")
        if candidate.is_file():
            candidate.unlink()
            removed_files.append(relative)
    for relative in EPHEMERAL_DIRECTORIES:
        candidate = workspace / relative
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            raise MigrationError(f"session directory became unsafe after preview: {candidate}")
        if candidate.is_dir():
            shutil.rmtree(candidate)
        candidate.mkdir(parents=True, mode=0o700)
        cleared_directories.append(relative)
    return {"removedFiles": removed_files, "clearedDirectories": cleared_directories}


def inspect_live_processes(connection: sqlite3.Connection) -> list[dict[str, object]]:
    active: list[dict[str, object]] = []
    existing = set(table_names(connection))
    if "operations" in existing:
        columns = {str(column["name"]) for column in table_shape(connection, "operations")}
        if {"id", "pid", "state"}.issubset(columns):
            for row in connection.execute(
                "SELECT id, pid, state FROM operations WHERE pid IS NOT NULL ORDER BY id"
            ):
                if process_is_alive(row[1]):
                    active.append(
                        {"kind": "operation", "id": str(row[0]), "pid": int(row[1]), "state": row[2]}
                    )
    if "media_items" in existing:
        columns = {str(column["name"]) for column in table_shape(connection, "media_items")}
        if {"video_id", "record_json"}.issubset(columns):
            for row in connection.execute(
                "SELECT video_id, record_json FROM media_items ORDER BY video_id"
            ):
                try:
                    record = json.loads(str(row[1]))
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                process = record.get("process") if isinstance(record, dict) else None
                pid = process.get("pid") if isinstance(process, dict) else None
                if process_is_alive(pid):
                    active.append(
                        {"kind": "media", "id": str(row[0]), "pid": int(pid), "state": record.get("state")}
                    )
    return active


def media_record_issue(record_json: object, video_id: object, expected_schema: int) -> str | None:
    if not isinstance(record_json, str):
        return "record_json is not text"
    try:
        record = json.loads(record_json)
    except (ValueError, json.JSONDecodeError):
        return "record_json is not valid JSON"
    if not isinstance(record, dict):
        return "record_json is not an object"
    if record.get("schemaVersion") != expected_schema:
        return f"media record schema is {record.get('schemaVersion')}, expected {expected_schema}"
    if set(record) != MEDIA_RECORD_FIELDS:
        return "media record fields do not match the current contract"
    if record.get("videoId") != video_id:
        return "media record videoId does not match its row"
    return None


def rows_from_connection(
    connection: sqlite3.Connection, table: str, columns: Iterable[str]
) -> list[dict[str, object]]:
    selected = list(columns)
    clause = ", ".join(quote_identifier(column) for column in selected)
    primary = [
        (int(column["primaryKey"]), str(column["name"]))
        for column in table_shape(connection, table)
        if int(column["primaryKey"]) > 0
    ]
    order = [name for _, name in sorted(primary)] or selected
    order_clause = ", ".join(quote_identifier(column) for column in order)
    return [
        {column: json_scalar(row[index]) for index, column in enumerate(selected)}
        for row in connection.execute(
            f"SELECT {clause} FROM {quote_identifier(table)} ORDER BY {order_clause}"
        )
    ]


def load_transform_bundle(
    workspace: Path,
    source_digest: str,
    target_inventory: dict[str, Any],
    source_counts: dict[str, int],
) -> dict[str, Any] | None:
    path = workspace / BUNDLE_FILENAME
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise MigrationError(f"transform bundle is unsafe: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, json.JSONDecodeError) as error:
        raise MigrationError(f"transform bundle is invalid JSON: {error}") from error
    if not isinstance(payload, dict) or set(payload) != {
        "schemaVersion",
        "sourceDatabaseDigest",
        "targetDataSchemaVersion",
        "tables",
        "acceptedDrops",
    }:
        raise MigrationError("transform bundle fields do not match the current migration contract")
    if payload.get("schemaVersion") != BUNDLE_SCHEMA_VERSION:
        raise MigrationError("transform bundle schemaVersion is unsupported")
    if payload.get("sourceDatabaseDigest") != source_digest:
        raise MigrationError("transform bundle was prepared from a different source database")
    if payload.get("targetDataSchemaVersion") != target_inventory["dataSchemaVersion"]:
        raise MigrationError("transform bundle targets a different INSU data schema")
    tables = payload.get("tables")
    if not isinstance(tables, dict) or not set(tables).issubset(DURABLE_TABLES):
        raise MigrationError("transform bundle contains unsupported table names")
    target_shapes = target_inventory["shapes"]
    for table, rows in tables.items():
        if not isinstance(rows, list):
            raise MigrationError(f"transform table {table} must be an array")
        expected_columns = [str(column["name"]) for column in target_shapes[table]]
        expected = set(expected_columns)
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or set(row) != expected:
                raise MigrationError(
                    f"transform row {table}[{index}] does not match the current table columns"
                )
            for value in row.values():
                json_scalar(value)
        if table == "media_items":
            for index, row in enumerate(rows):
                issue = media_record_issue(
                    row.get("record_json"),
                    row.get("video_id"),
                    int(target_inventory["mediaRecordSchemaVersion"]),
                )
                if issue:
                    raise MigrationError(f"transform row media_items[{index}] is invalid: {issue}")
    accepted = payload.get("acceptedDrops")
    if not isinstance(accepted, list):
        raise MigrationError("transform bundle acceptedDrops must be an array")
    seen: set[str] = set()
    for item in accepted:
        if not isinstance(item, dict) or set(item) != {"table", "rowCount", "reason"}:
            raise MigrationError("acceptedDrops entries must contain table, rowCount, and reason")
        table = item.get("table")
        reason = item.get("reason")
        row_count = item.get("rowCount")
        if (
            not isinstance(table, str)
            or table in seen
            or table in DURABLE_TABLES
            or table in EPHEMERAL_TABLES
            or table not in source_counts
            or isinstance(row_count, bool)
            or not isinstance(row_count, int)
            or row_count != source_counts[table]
            or not isinstance(reason, str)
            or not reason.strip()
            or reason.strip().upper() == "TODO"
        ):
            raise MigrationError(f"accepted drop is invalid: {item}")
        seen.add(table)
    return {
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "payload": payload,
    }


def planned_table_rows(
    source: sqlite3.Connection,
    table: str,
    action: str,
    target_shape: list[dict[str, object]],
    bundle: dict[str, Any] | None,
) -> list[dict[str, object]]:
    columns = [str(column["name"]) for column in target_shape]
    if action == "copy-exact":
        return rows_from_connection(source, table, columns)
    if action == "transform":
        assert bundle is not None
        rows = bundle["payload"]["tables"][table]
        return [{column: row[column] for column in columns} for row in rows]
    return []


def inspect_planned_artifact_files(
    workspace: Path,
    rows: list[dict[str, object]],
) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    for row in rows:
        kind = row.get("kind")
        lifecycle = row.get("lifecycle_state")
        if kind == "source" or lifecycle != "ready":
            continue
        video_id = row.get("video_id")
        artifact_id = row.get("id")
        relative = row.get("manifest_path")
        if not isinstance(video_id, str) or not isinstance(relative, str):
            issues.append({"artifactId": str(artifact_id), "issue": "manifest path is missing"})
            continue
        path = workspace / "jobs" / video_id / relative
        if path.is_symlink() or not path.is_file():
            issues.append({"artifactId": str(artifact_id), "issue": "manifest file is missing"})
            continue
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            issues.append({"artifactId": str(artifact_id), "issue": "manifest is invalid JSON"})
            continue
        expected = 4 if kind == "segmentation" else 5
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != expected:
            issues.append(
                {"artifactId": str(artifact_id), "issue": f"manifest must use schemaVersion {expected}"}
            )
    return issues


def inspect_planned_media_files(
    workspace: Path,
    rows: list[dict[str, object]],
) -> list[dict[str, str]]:
    media_catalog = load_python_module(
        watch_skill_root() / "scripts" / "media_catalog.py",
        "insu_preview_media_catalog",
    )
    issues: list[dict[str, str]] = []
    for row in rows:
        video_id = str(row.get("video_id"))
        try:
            record = json.loads(str(row.get("record_json")))
        except (ValueError, json.JSONDecodeError):
            continue
        if not isinstance(record, dict) or not isinstance(record.get("assets"), dict):
            continue
        job_directory = workspace / "jobs" / video_id
        for name, asset in record["assets"].items():
            if not isinstance(asset, dict):
                issues.append({"videoId": video_id, "issue": f"asset {name} metadata is invalid"})
                continue
            try:
                path = safe_registered_file(job_directory, asset.get("path"), f"asset {name}")
            except MigrationError as error:
                issues.append({"videoId": video_id, "issue": str(error)})
                continue
            expected_bytes = asset.get("bytes")
            if isinstance(expected_bytes, int) and not isinstance(expected_bytes, bool):
                if path.stat().st_size != expected_bytes:
                    issues.append({"videoId": video_id, "issue": f"asset {name} size does not match"})
        if "mediaCatalog" in record["assets"]:
            try:
                catalog = media_catalog.load_catalog(job_directory, video_id)
                operation = catalog.get("operation")
                if isinstance(operation, dict) and operation.get("state") not in {
                    "ready",
                    "failed",
                    "interrupted",
                }:
                    issues.append(
                        {"videoId": video_id, "issue": "media catalog contains active runtime state"}
                    )
            except (OSError, ValueError, json.JSONDecodeError) as error:
                issues.append({"videoId": video_id, "issue": f"media catalog is invalid: {error}"})
    return issues


def build_plan(project_root: Path, workspace: Path) -> dict[str, Any]:
    contract = current_contract()
    target = current_schema_inventory(contract)
    source_path = workspace / "app.db"
    source = open_readonly_database(source_path)
    try:
        source_tables = table_names(source)
        source_shapes = {table: table_shape(source, table) for table in source_tables}
        source_counts = {table: table_count(source, table) for table in source_tables}
        source_digest = database_digest(source)
        source_info = {
            "applicationId": int(source.execute("PRAGMA application_id").fetchone()[0]),
            "dataSchemaVersion": int(source.execute("PRAGMA user_version").fetchone()[0]),
            "integrity": str(source.execute("PRAGMA integrity_check").fetchone()[0]),
            "digest": source_digest,
            "tables": source_counts,
        }
        bundle = load_transform_bundle(workspace, source_digest, target, source_counts)
        bundle_tables = set(bundle["payload"]["tables"]) if bundle else set()
        accepted_drops = {
            str(item["table"]): item
            for item in (bundle["payload"]["acceptedDrops"] if bundle else [])
        }
        actions: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []

        policy_tables = set(DURABLE_TABLES) | set(EPHEMERAL_TABLES)
        unclassified_target = sorted(set(target["tables"]) - policy_tables)
        if unclassified_target:
            blocked.append({"code": "unclassified-current-table", "tables": unclassified_target})

        for table in DURABLE_TABLES:
            source_count = source_counts.get(table, 0)
            if table in bundle_tables:
                action = "transform"
                target_count = len(bundle["payload"]["tables"][table])
            elif table not in source_tables or source_count == 0:
                action = "initialize-empty"
                target_count = 0
            elif table == "transcription_settings":
                action = "needs-transform"
                target_count = None
                blocked.append(
                    {
                        "code": "needs-transcription-selection-validation",
                        "table": table,
                        "rowCount": source_count,
                        "requirement": "keep only a model ID present in the installed current catalog",
                    }
                )
            elif source_shapes[table] == target["shapes"][table]:
                action = "copy-exact"
                target_count = source_count
            else:
                action = "needs-transform"
                target_count = None
                blocked.append(
                    {
                        "code": "needs-table-transform",
                        "table": table,
                        "sourceColumns": [column["name"] for column in source_shapes[table]],
                        "targetColumns": [column["name"] for column in target["shapes"][table]],
                        "rowCount": source_count,
                    }
                )
            actions.append(
                {
                    "table": table,
                    "category": "durable",
                    "action": action,
                    "sourceRows": source_count,
                    "targetRows": target_count,
                }
            )

        for table in EPHEMERAL_TABLES:
            actions.append(
                {
                    "table": table,
                    "category": "ephemeral",
                    "action": "drop-and-rebuild",
                    "sourceRows": source_counts.get(table, 0),
                    "targetRows": 0,
                }
            )

        for table in sorted(set(source_tables) - policy_tables):
            count = source_counts[table]
            if count == 0:
                action = "drop-empty-legacy-table"
            elif table in accepted_drops:
                action = "drop-explicitly-accepted"
            else:
                action = "needs-explicit-drop-reason"
                blocked.append(
                    {"code": "unknown-source-table", "table": table, "rowCount": count}
                )
            actions.append(
                {
                    "table": table,
                    "category": "legacy-only",
                    "action": action,
                    "sourceRows": count,
                    "targetRows": 0,
                }
            )

        media_action = next(item for item in actions if item["table"] == "media_items")
        if media_action["action"] in {"copy-exact", "transform"}:
            media_rows = planned_table_rows(
                source,
                "media_items",
                str(media_action["action"]),
                target["shapes"]["media_items"],
                bundle,
            )
            media_issues = [
                {"videoId": row.get("video_id"), "issue": issue}
                for row in media_rows
                if (
                    issue := media_record_issue(
                        row.get("record_json"),
                        row.get("video_id"),
                        contract["mediaRecordSchemaVersion"],
                    )
                )
            ]
            if media_issues:
                blocked.append(
                    {
                        "code": "needs-media-record-transform",
                        "table": "media_items",
                        "issues": media_issues[:20],
                    }
                )
            media_file_issues = inspect_planned_media_files(workspace, media_rows)
            if media_file_issues:
                blocked.append(
                    {"code": "invalid-current-media-files", "issues": media_file_issues[:20]}
                )
        else:
            media_rows = []

        artifact_action = next(item for item in actions if item["table"] == "subtitle_artifacts")
        if artifact_action["action"] in {"copy-exact", "transform"}:
            artifact_rows = planned_table_rows(
                source,
                "subtitle_artifacts",
                str(artifact_action["action"]),
                target["shapes"]["subtitle_artifacts"],
                bundle,
            )
            file_issues = inspect_planned_artifact_files(workspace, artifact_rows)
            if file_issues:
                blocked.append(
                    {
                        "code": "invalid-current-artifact-files",
                        "issues": file_issues[:20],
                        "requiredTransformTables": list(DERIVED_ARTIFACT_TRANSFORM_TABLES),
                    }
                )

        jobs = inspect_jobs(workspace)
        if media_action["action"] in {"copy-exact", "transform", "initialize-empty"}:
            media_ids = sorted(str(row["video_id"]) for row in media_rows)
            missing_jobs = sorted(set(media_ids) - set(jobs["jobIds"]))
            orphan_jobs = sorted(set(jobs["jobIds"]) - set(media_ids))
            if missing_jobs:
                blocked.append({"code": "missing-job-directory", "videoIds": missing_jobs})
            if orphan_jobs:
                blocked.append({"code": "orphan-job-directory", "videoIds": orphan_jobs})
        if jobs["unsafeEntries"]:
            blocked.append({"code": "unsafe-job-entry", "paths": jobs["unsafeEntries"]})

        if source_info["applicationId"] != contract["applicationId"]:
            blocked.append({"code": "not-an-insu-database"})
        if source_info["dataSchemaVersion"] > contract["dataSchemaVersion"]:
            blocked.append(
                {
                    "code": "source-newer-than-installed-code",
                    "source": source_info["dataSchemaVersion"],
                    "target": contract["dataSchemaVersion"],
                }
            )
        if source_info["integrity"] != "ok":
            blocked.append({"code": "source-integrity-check-failed", "result": source_info["integrity"]})
        blocked.extend(ephemeral_filesystem_blockers(workspace))
        live_processes = inspect_live_processes(source)
        if live_processes:
            blocked.append({"code": "live-job-process", "processes": live_processes})

        stable = {
            "schemaVersion": PLAN_SCHEMA_VERSION,
            "operation": "migrate-player-library",
            "projectRoot": str(project_root),
            "workspace": str(workspace),
            "source": source_info,
            "target": {
                "applicationId": target["applicationId"],
                "dataSchemaVersion": target["dataSchemaVersion"],
                "mediaRecordSchemaVersion": target["mediaRecordSchemaVersion"],
                "schemaSha256": target["schemaSha256"],
            },
            "jobs": jobs,
            "tableActions": sorted(actions, key=lambda item: str(item["table"])),
            "transformBundle": (
                {"path": bundle["path"], "sha256": bundle["sha256"]} if bundle else None
            ),
            "dataBoundary": {
                "preserve": [
                    "current-shape durable SQLite rows",
                    "validated media and artifact files under jobs/**",
                    "playback state, notes, tags, subtitle styles, and transcription selection",
                ],
                "discard": [
                    "session-only API keys",
                    "Cookie jars and extension tokens",
                    "download queues, live operations, resumable runs, and runtime capability cache",
                    "legacy-only tables explicitly accepted in the transform bundle",
                ],
                "runtimeCompatibilityLayer": False,
            },
            "filesystemDiscard": {
                "files": list(SESSION_FILES),
                "directories": list(EPHEMERAL_DIRECTORIES),
            },
            "blocked": blocked,
        }
        digest = hashlib.sha256(canonical_json(stable).encode("utf-8")).hexdigest()
        return {
            **stable,
            "server": inspect_server(workspace),
            "requiresServerStopBeforeExecute": True,
            "digest": digest,
            "confirmation": f"確認遷移 {digest}",
        }
    finally:
        source.close()


def preview(args: argparse.Namespace) -> int:
    project_root, workspace = resolve_scope(args.project_root, args.workspace)
    print_json(build_plan(project_root, workspace))
    return 0


def prepare_bundle(args: argparse.Namespace) -> int:
    project_root, workspace = resolve_scope(args.project_root, args.workspace)
    path = workspace / BUNDLE_FILENAME
    if path.exists() and not args.overwrite:
        raise MigrationError(f"transform bundle already exists: {path}")
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise MigrationError(f"transform bundle target is unsafe: {path}")

    # Build the plan without a stale bundle so the template is always tied to
    # the exact source snapshot.
    previous: bytes | None = path.read_bytes() if path.is_file() else None
    if path.is_file():
        path.unlink()
    try:
        plan = build_plan(project_root, workspace)
        source = open_readonly_database(workspace / "app.db")
        try:
            target = current_schema_inventory(current_contract())
            transform_tables = {
                str(blocker["table"])
                for blocker in plan["blocked"]
                if blocker.get("code") in {
                    "needs-table-transform",
                    "needs-media-record-transform",
                    "needs-transcription-selection-validation",
                }
                and isinstance(blocker.get("table"), str)
            }
            for blocker in plan["blocked"]:
                required_tables = blocker.get("requiredTransformTables")
                if isinstance(required_tables, list):
                    transform_tables.update(
                        str(table)
                        for table in required_tables
                        if isinstance(table, str) and table in DURABLE_TABLES
                    )
            if args.table:
                requested = set(args.table)
                if not requested.issubset(DURABLE_TABLES):
                    raise MigrationError("--table accepts only durable current table names")
                transform_tables |= requested
            if not transform_tables and not any(
                blocker.get("code") == "unknown-source-table" for blocker in plan["blocked"]
            ):
                raise MigrationError("the current preview does not require a transform bundle")
            source_tables = set(table_names(source))
            tables: dict[str, list[dict[str, object]]] = {}
            for table in sorted(transform_tables):
                target_columns = [str(column["name"]) for column in target["shapes"][table]]
                if table not in source_tables:
                    tables[table] = []
                    continue
                source_columns = {
                    str(column["name"]) for column in table_shape(source, table)
                }
                source_rows = rows_from_connection(source, table, sorted(source_columns))
                tables[table] = [
                    {
                        column: row[column] if column in source_columns else None
                        for column in target_columns
                    }
                    for row in source_rows
                ]
            accepted_drops = [
                {
                    "table": str(blocker["table"]),
                    "rowCount": int(blocker["rowCount"]),
                    "reason": "TODO",
                }
                for blocker in plan["blocked"]
                if blocker.get("code") == "unknown-source-table"
            ]
            payload = {
                "schemaVersion": BUNDLE_SCHEMA_VERSION,
                "sourceDatabaseDigest": plan["source"]["digest"],
                "targetDataSchemaVersion": target["dataSchemaVersion"],
                "tables": tables,
                "acceptedDrops": accepted_drops,
            }
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.chmod(path, 0o600)
        finally:
            source.close()
    except Exception:
        if path.is_file():
            path.unlink()
        if previous is not None:
            path.write_bytes(previous)
            os.chmod(path, 0o600)
        raise
    print_json(
        {
            "operation": "prepare-migration-transform-bundle",
            "path": str(path),
            "tables": sorted(tables),
            "next": "Agent must convert every row to the current semantic contract, replace every TODO drop reason, then run preview again",
        }
    )
    return 0


def insert_rows(
    connection: sqlite3.Connection,
    table: str,
    shape: list[dict[str, object]],
    rows: list[dict[str, object]],
) -> None:
    if not rows:
        return
    columns = [str(column["name"]) for column in shape]
    statement = (
        f"INSERT INTO {quote_identifier(table)} "
        f"({', '.join(quote_identifier(column) for column in columns)}) "
        f"VALUES ({', '.join('?' for _ in columns)})"
    )
    connection.executemany(
        statement,
        [[row[column] for column in columns] for row in rows],
    )


def safe_registered_file(job_directory: Path, relative_path: object, label: str) -> Path:
    if not isinstance(relative_path, str):
        raise MigrationError(f"{label} path is not text")
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise MigrationError(f"{label} path leaves its job")
    candidate = job_directory / relative
    if candidate.is_symlink() or not candidate.is_file():
        raise MigrationError(f"{label} file is unavailable: {relative_path}")
    resolved_job = job_directory.resolve()
    resolved_candidate = candidate.resolve()
    if resolved_job not in resolved_candidate.parents:
        raise MigrationError(f"{label} path leaves its job")
    return candidate


def verify_checksum(path: Path, checksum: object, label: str) -> None:
    if not isinstance(checksum, str) or len(checksum) != 64:
        raise MigrationError(f"{label} checksum is invalid")
    if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
        raise MigrationError(f"{label} checksum does not match")


def validate_registered_content(
    validation_jobs: Path,
    connection: sqlite3.Connection,
    records: dict[str, dict[str, Any]],
) -> dict[str, int]:
    media_catalog = load_python_module(
        watch_skill_root() / "scripts" / "media_catalog.py",
        "insu_current_media_catalog",
    )
    for video_id, record in records.items():
        job_directory = validation_jobs / video_id
        assets = record.get("assets")
        if not isinstance(assets, dict):
            raise MigrationError(f"media record assets are invalid: {video_id}")
        for name, asset in assets.items():
            if not isinstance(asset, dict):
                raise MigrationError(f"media asset metadata is invalid: {video_id}/{name}")
            path = safe_registered_file(job_directory, asset.get("path"), f"media asset {name}")
            expected_bytes = asset.get("bytes")
            if isinstance(expected_bytes, int) and not isinstance(expected_bytes, bool):
                if path.stat().st_size != expected_bytes:
                    raise MigrationError(f"media asset size does not match: {video_id}/{name}")
        if "mediaCatalog" in assets:
            catalog = media_catalog.load_catalog(job_directory, video_id)
            operation = catalog.get("operation")
            if isinstance(operation, dict) and operation.get("state") not in {
                "ready",
                "failed",
                "interrupted",
            }:
                raise MigrationError(f"media catalog still contains active runtime state: {video_id}")

    for row in connection.execute(
        "SELECT video_id, kind, relative_path, size_bytes, available FROM job_assets "
        "WHERE available = 1 ORDER BY video_id, id"
    ):
        path = safe_registered_file(
            validation_jobs / str(row[0]), row[2], f"job asset {row[0]}/{row[1]}"
        )
        if row[3] is not None and path.stat().st_size != int(row[3]):
            raise MigrationError(f"job asset size does not match: {row[0]}/{row[1]}")

    rendition_count = 0
    for row in connection.execute(
        "SELECT video_id, id, relative_path, size_bytes, checksum "
        "FROM media_renditions ORDER BY video_id, id"
    ):
        path = safe_registered_file(
            validation_jobs / str(row[0]), row[2], f"media rendition {row[0]}/{row[1]}"
        )
        if path.stat().st_size != int(row[3]):
            raise MigrationError(f"media rendition size does not match: {row[0]}/{row[1]}")
        verify_checksum(path, row[4], f"media rendition {row[0]}/{row[1]}")
        rendition_count += 1

    track_count = 0
    for row in connection.execute(
        "SELECT video_id, id, relative_path, size_bytes, checksum "
        "FROM subtitle_artifact_tracks ORDER BY video_id, id"
    ):
        path = safe_registered_file(
            validation_jobs / str(row[0]), row[2], f"subtitle track {row[1]}"
        )
        if row[3] is not None and path.stat().st_size != int(row[3]):
            raise MigrationError(f"subtitle track size does not match: {row[1]}")
        verify_checksum(path, row[4], f"subtitle track {row[1]}")
        track_count += 1

    database_artifacts: dict[str, set[str]] = {}
    for row in connection.execute(
        "SELECT video_id, id FROM subtitle_artifacts ORDER BY video_id, id"
    ):
        database_artifacts.setdefault(str(row[0]), set()).add(str(row[1]))
    for video_id, record in records.items():
        record_artifacts = record.get("subtitleArtifacts")
        assert isinstance(record_artifacts, list)
        record_ids = {str(artifact["id"]) for artifact in record_artifacts}
        if record_ids != database_artifacts.get(video_id, set()):
            raise MigrationError(f"subtitle artifact projection does not match: {video_id}")
    if set(database_artifacts) - set(records):
        raise MigrationError("subtitle artifacts reference an unknown media item")

    summary_validator = load_python_module(
        skill_root().parent / "summarize-video" / "scripts" / "validate_summary.py",
        "insu_current_summary_validator",
    )
    mindmap_validator = load_python_module(
        skill_root().parent / "map-video-summary" / "scripts" / "validate_mindmap.py",
        "insu_current_mindmap_validator",
    )
    dependencies: dict[str, list[tuple[str, str]]] = {}
    for row in connection.execute(
        "SELECT artifact_id, dependency_type, dependency_id "
        "FROM summary_dependencies ORDER BY artifact_id, dependency_type, dependency_id"
    ):
        dependencies.setdefault(str(row[0]), []).append((str(row[1]), str(row[2])))
    summary_count = 0
    for row in connection.execute(
        "SELECT id, video_id, kind, language_code, title, processor_provider, "
        "processor_service, relative_path, checksum, validation_state "
        "FROM summary_artifacts ORDER BY video_id, id"
    ):
        artifact_id = str(row[0])
        video_id = str(row[1])
        kind = str(row[2])
        if (row[5], row[6], row[9]) != ("agent", "codex", "valid"):
            raise MigrationError(f"summary processor or validation is invalid: {artifact_id}")
        path = safe_registered_file(
            validation_jobs / video_id, row[7], f"summary artifact {artifact_id}"
        )
        if not str(row[7]).startswith(f"summaries/{artifact_id}/"):
            raise MigrationError(f"summary path leaves its artifact: {artifact_id}")
        verify_checksum(path, row[8], f"summary artifact {artifact_id}")
        artifact_dependencies = dependencies.get(artifact_id, [])
        if len(artifact_dependencies) != 1:
            raise MigrationError(f"summary dependency is invalid: {artifact_id}")
        dependency_type, dependency_id = artifact_dependencies[0]
        language = summary_validator.safe_text(str(row[3]), "language", 40)
        title = summary_validator.safe_text(str(row[4]), "title", 160)
        content = summary_validator.safe_text(
            path.read_text(encoding="utf-8"), "content", summary_validator.MAX_BYTES
        )
        if len(content.encode("utf-8")) > summary_validator.MAX_BYTES:
            raise MigrationError(f"summary content is too large: {artifact_id}")
        if kind == "text":
            if dependency_type != "subtitle" or not summary_validator.ARTIFACT_ID.fullmatch(dependency_id):
                raise MigrationError(f"text summary dependency is invalid: {artifact_id}")
            if not summary_validator.LANGUAGE.fullmatch(language):
                raise MigrationError(f"text summary language is invalid: {artifact_id}")
        elif kind == "mindmap":
            if dependency_type != "summary" or not mindmap_validator.ARTIFACT_ID.fullmatch(dependency_id):
                raise MigrationError(f"mind map dependency is invalid: {artifact_id}")
            if not mindmap_validator.LANGUAGE.fullmatch(language):
                raise MigrationError(f"mind map language is invalid: {artifact_id}")
            mindmap_validator.safe_text(title, "title", 160)
            mindmap_validator.validate_tree(content, video_id)
        else:
            raise MigrationError(f"summary kind is invalid: {artifact_id}")
        summary_count += 1

    return {
        "renditions": rendition_count,
        "subtitleTracks": track_count,
        "summaryArtifacts": summary_count,
    }


def verify_files_and_records(workspace: Path, database: Path) -> dict[str, Any]:
    module = load_job_state_module()
    validation_root = database.parent / "validation"
    if validation_root.exists():
        raise MigrationError(f"validation directory already exists: {validation_root}")
    validation_root.mkdir(mode=0o700)
    validation_database = validation_root / "app.db"
    validation_jobs = validation_root / "jobs"
    try:
        shutil.copy2(database, validation_database)
        try:
            shutil.copytree(workspace / "jobs", validation_jobs, copy_function=os.link)
        except OSError as error:
            raise MigrationError(f"cannot create read-only hard-link validation tree: {error}") from error
        connection = open_readonly_database(validation_database)
        try:
            video_ids = [
                str(row[0])
                for row in connection.execute("SELECT video_id FROM media_items ORDER BY video_id")
            ]
            records = {
                video_id: module.load_status(validation_jobs / video_id)
                for video_id in video_ids
            }
            registered = validate_registered_content(validation_jobs, connection, records)
        finally:
            connection.close()
        return {
            "mediaItems": len(video_ids),
            "validatedVideoIds": video_ids,
            **registered,
        }
    finally:
        shutil.rmtree(validation_root, ignore_errors=True)


def verify_database_contract(database: Path, contract: dict[str, int]) -> dict[str, Any]:
    connection = open_readonly_database(database)
    try:
        application_id = int(connection.execute("PRAGMA application_id").fetchone()[0])
        data_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        foreign_keys = [list(row) for row in connection.execute("PRAGMA foreign_key_check")]
        current_tables = set(table_names(connection))
        expected_tables = set(DURABLE_TABLES) | set(EPHEMERAL_TABLES)
        ephemeral_counts = {
            table: table_count(connection, table)
            for table in EPHEMERAL_TABLES
            if table in current_tables
        }
        unsafe_ephemeral_counts = {
            table: count
            for table, count in ephemeral_counts.items()
            if table not in REBUILDABLE_BOOTSTRAP_TABLES and count != 0
        }
        valid = (
            application_id == contract["applicationId"]
            and data_version == contract["dataSchemaVersion"]
            and integrity == "ok"
            and not foreign_keys
            and current_tables == expected_tables
            and not unsafe_ephemeral_counts
        )
        result = {
            "valid": valid,
            "applicationId": application_id,
            "dataSchemaVersion": data_version,
            "integrity": integrity,
            "foreignKeyErrors": foreign_keys,
            "missingTables": sorted(expected_tables - current_tables),
            "unexpectedTables": sorted(current_tables - expected_tables),
            "ephemeralTables": ephemeral_counts,
            "unsafeEphemeralTables": unsafe_ephemeral_counts,
            "mediaItems": table_count(connection, "media_items") if "media_items" in current_tables else 0,
        }
        if not valid:
            raise MigrationError(f"staged database does not match the current contract: {result}")
        return result
    finally:
        connection.close()


def execute(args: argparse.Namespace) -> int:
    if not args.yes:
        raise MigrationError("execute requires --yes after confirmation of the exact digest")
    project_root, workspace = resolve_scope(args.project_root, args.workspace)
    plan = build_plan(project_root, workspace)
    if plan["digest"] != args.plan_digest:
        raise MigrationError(
            f"migration plan changed, create a new preview and confirm digest {plan['digest']}"
        )
    if plan["blocked"]:
        raise MigrationError("migration plan is blocked and cannot execute")
    if plan["server"]["alive"]:
        raise MigrationError("workspace server is still running, stop it before execute")

    contract = current_contract()
    target_inventory = current_schema_inventory(contract)
    run_directory = workspace / MIGRATION_DIRECTORY / args.plan_digest
    if run_directory.exists():
        raise MigrationError(f"migration run already exists: {run_directory}")
    run_directory.mkdir(parents=True, mode=0o700)
    staging_database = run_directory / "target-app.db"
    source = open_readonly_database(workspace / "app.db")
    target = build_current_database(staging_database, contract)
    try:
        bundle = load_transform_bundle(
            workspace,
            str(plan["source"]["digest"]),
            target_inventory,
            {table: table_count(source, table) for table in table_names(source)},
        )
        actions = {str(item["table"]): str(item["action"]) for item in plan["tableActions"]}
        target.execute("PRAGMA foreign_keys = OFF")
        target.execute("BEGIN IMMEDIATE")
        for table in DURABLE_TABLES:
            rows = planned_table_rows(
                source,
                table,
                actions[table],
                target_inventory["shapes"][table],
                bundle,
            )
            insert_rows(target, table, target_inventory["shapes"][table], rows)
        target.commit()
        target.execute("PRAGMA foreign_keys = ON")
        foreign_key_errors = list(target.execute("PRAGMA foreign_key_check"))
        if foreign_key_errors:
            raise MigrationError(f"staged migration has foreign key errors: {foreign_key_errors[:20]}")
        target.execute("PRAGMA journal_mode = DELETE")
        target.commit()
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        source.close()

    os.chmod(staging_database, 0o600)
    staged_database = verify_database_contract(staging_database, contract)
    staged_files = verify_files_and_records(workspace, staging_database)

    source_archive = run_directory / "source"
    source_archive.mkdir(mode=0o700)
    moved: list[tuple[Path, Path]] = []
    try:
        for filename in DATABASE_FILES:
            current = workspace / filename
            if current.is_symlink() or (current.exists() and not current.is_file()):
                raise MigrationError(f"database target became unsafe after preview: {current}")
            if current.is_file():
                archived = source_archive / filename
                os.replace(current, archived)
                moved.append((archived, current))
        os.replace(staging_database, workspace / "app.db")
        current_database = verify_database_contract(workspace / "app.db", contract)
        cutover_validation_database = run_directory / "verify-current-app.db"
        shutil.copy2(workspace / "app.db", cutover_validation_database)
        try:
            current_files = verify_files_and_records(workspace, cutover_validation_database)
        finally:
            if cutover_validation_database.is_file():
                cutover_validation_database.unlink()
        cleared_sessions = clear_ephemeral_filesystem(workspace)
    except Exception as error:
        failed = workspace / "app.db"
        if failed.is_file() and not failed.is_symlink():
            os.replace(failed, run_directory / "failed-target-app.db")
        for archived, original in reversed(moved):
            if archived.is_file():
                os.replace(archived, original)
        raise MigrationError(f"cutover failed and the source database was restored: {error}") from error

    bundle_path = workspace / BUNDLE_FILENAME
    if bundle_path.is_file() and not bundle_path.is_symlink():
        os.replace(bundle_path, run_directory / "transform-input.json")
    result = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "operation": "migrate-player-library",
        "status": "executed-and-verified",
        "digest": args.plan_digest,
        "workspace": str(workspace),
        "sourceBackup": str(source_archive / "app.db"),
        "stagedDatabase": staged_database,
        "stagedFiles": staged_files,
        "currentDatabase": current_database,
        "currentFiles": current_files,
        "clearedSessions": cleared_sessions,
        "rollbackAvailable": True,
        "next": "restart the workspace homepage, run verify, and inspect the migrated library before removing the source backup",
    }
    (run_directory / "migration-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print_json(result)
    return 0


def verify(args: argparse.Namespace) -> int:
    _, workspace = resolve_scope(args.project_root, args.workspace)
    contract = current_contract()
    database = verify_database_contract(workspace / "app.db", contract)
    temporary_root = workspace / MIGRATION_DIRECTORY / "verify-current"
    if temporary_root.exists():
        shutil.rmtree(temporary_root)
    temporary_root.mkdir(parents=True, mode=0o700)
    temporary_database = temporary_root / "current-app.db"
    shutil.copy2(workspace / "app.db", temporary_database)
    try:
        files = verify_files_and_records(workspace, temporary_database)
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)
    result = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "operation": "verify-migrated-player-library",
        "valid": True,
        "workspace": str(workspace),
        "database": database,
        "files": files,
        "server": inspect_server(workspace),
    }
    print_json(result)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("preview", "prepare-bundle", "execute", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--project-root", required=True)
        subparser.add_argument("--workspace", required=True)
        if command == "prepare-bundle":
            subparser.add_argument("--table", action="append", default=[])
            subparser.add_argument("--overwrite", action="store_true")
        if command == "execute":
            subparser.add_argument("--plan-digest", required=True)
            subparser.add_argument("--yes", action="store_true")
        subparser.set_defaults(
            handler={
                "preview": preview,
                "prepare-bundle": prepare_bundle,
                "execute": execute,
                "verify": verify,
            }[command]
        )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except (MigrationError, sqlite3.Error, OSError, ValueError) as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    raise SystemExit(main())
