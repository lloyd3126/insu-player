#!/usr/bin/env python3
"""Preview, execute, and verify removal of one owned INSU Player resource."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


SCHEMA_VERSION = 1
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
ARTIFACT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
RENDITION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
SQL_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
class RemovalError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def safe_identifier(identifier: str) -> str:
    if not SQL_IDENTIFIER_PATTERN.fullmatch(identifier):
        raise RemovalError(f"unsafe SQLite identifier: {identifier!r}")
    return f'"{identifier}"'


def resolve_workspace(raw: str) -> Path:
    workspace = Path(raw).expanduser().resolve()
    if workspace == Path(workspace.anchor) or workspace == Path.home().resolve():
        raise RemovalError("workspace must be a dedicated directory, not the filesystem root or home")
    if not workspace.is_dir():
        raise RemovalError(f"workspace not found: {workspace}")
    jobs = workspace / "jobs"
    if not jobs.is_dir() or jobs.is_symlink():
        raise RemovalError(f"workspace jobs directory is missing or unsafe: {jobs}")
    return workspace


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_PATTERN.fullmatch(video_id):
        raise RemovalError("video ID may contain only letters, numbers, underscore, and hyphen")
    return video_id


def validate_artifact_id(artifact_id: str) -> str:
    if not ARTIFACT_ID_PATTERN.fullmatch(artifact_id):
        raise RemovalError("subtitle artifact ID contains unsupported characters")
    return artifact_id


def validate_rendition_id(rendition_id: str) -> str:
    if not RENDITION_ID_PATTERN.fullmatch(rendition_id):
        raise RemovalError("media rendition ID contains unsupported characters")
    return rendition_id


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


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


def read_status(job_directory: Path) -> tuple[dict[str, Any], str | None]:
    status_path = job_directory / "status.json"
    try:
        payload = json.loads(status_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("status must be a JSON object")
        return payload, None
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return {}, str(error)


def filesystem_inventory(workspace: Path, job_directory: Path) -> dict[str, Any]:
    entries: list[dict[str, object]] = []
    symlinks: list[str] = []
    file_count = 0
    total_bytes = 0

    for root, directories, files in os.walk(job_directory, topdown=True, followlinks=False):
        root_path = Path(root)
        directories.sort()
        files.sort()
        safe_directories: list[str] = []
        for name in directories:
            candidate = root_path / name
            relative = candidate.relative_to(workspace).as_posix()
            if candidate.is_symlink():
                symlinks.append(relative)
                continue
            stat = candidate.stat(follow_symlinks=False)
            entries.append(
                {
                    "path": relative,
                    "type": "directory",
                    "mtimeNs": stat.st_mtime_ns,
                }
            )
            safe_directories.append(name)
        directories[:] = safe_directories

        for name in files:
            candidate = root_path / name
            relative = candidate.relative_to(workspace).as_posix()
            if candidate.is_symlink():
                symlinks.append(relative)
                continue
            stat = candidate.stat(follow_symlinks=False)
            if not candidate.is_file():
                symlinks.append(relative)
                continue
            file_count += 1
            total_bytes += stat.st_size
            entries.append(
                {
                    "path": relative,
                    "type": "file",
                    "bytes": stat.st_size,
                    "mtimeNs": stat.st_mtime_ns,
                }
            )

    fingerprint = hashlib.sha256(canonical_json(entries).encode("utf-8")).hexdigest()
    return {
        "path": job_directory.relative_to(workspace).as_posix(),
        "files": file_count,
        "bytes": total_bytes,
        "fingerprint": fingerprint,
        "symlinks": sorted(symlinks),
    }


def database_connection_readonly(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def inspect_database(database_path: Path, video_id: str) -> dict[str, Any]:
    if not database_path.exists():
        return {
            "path": database_path.name,
            "exists": False,
            "jobsTable": False,
            "rows": [],
            "unsafeReferences": [],
            "error": None,
        }
    if database_path.is_symlink() or not database_path.is_file():
        return {
            "path": database_path.name,
            "exists": True,
            "jobsTable": False,
            "rows": [],
            "unsafeReferences": [],
            "error": "app.db is not a regular workspace-owned file",
        }

    try:
        connection = database_connection_readonly(database_path)
        try:
            table_names = [
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                )
            ]
            jobs_table = "jobs" in table_names
            relevant: dict[str, dict[str, object]] = {}
            unsafe_references: list[dict[str, str]] = []

            if jobs_table:
                count = int(
                    connection.execute(
                        'SELECT COUNT(*) FROM "jobs" WHERE "video_id" = ?', (video_id,)
                    ).fetchone()[0]
                )
                relevant["jobs"] = {"table": "jobs", "rows": count, "delete": "primary"}

            for table_name in table_names:
                quoted_table = safe_identifier(table_name)
                foreign_keys = connection.execute(
                    f"PRAGMA foreign_key_list({quoted_table})"
                ).fetchall()
                references_jobs = [
                    row
                    for row in foreign_keys
                    if str(row["table"]) == "jobs" and str(row["from"]) == "video_id"
                ]
                if not references_jobs:
                    continue
                count = int(
                    connection.execute(
                        f'SELECT COUNT(*) FROM {quoted_table} WHERE "video_id" = ?',
                        (video_id,),
                    ).fetchone()[0]
                )
                relevant[table_name] = {
                    "table": table_name,
                    "rows": count,
                    "delete": "cascade",
                }
                for foreign_key in references_jobs:
                    on_delete = str(foreign_key["on_delete"] or "NO ACTION").upper()
                    if on_delete != "CASCADE":
                        unsafe_references.append(
                            {"table": table_name, "onDelete": on_delete}
                        )

            return {
                "path": database_path.name,
                "exists": True,
                "jobsTable": jobs_table,
                "rows": sorted(relevant.values(), key=lambda item: str(item["table"])),
                "unsafeReferences": sorted(
                    unsafe_references, key=lambda item: (item["table"], item["onDelete"])
                ),
                "error": None,
            }
        finally:
            connection.close()
    except (OSError, sqlite3.Error, RemovalError) as error:
        return {
            "path": database_path.name,
            "exists": True,
            "jobsTable": False,
            "rows": [],
            "unsafeReferences": [],
            "error": str(error),
        }


def plan_digest(plan: dict[str, Any]) -> str:
    stable = {key: value for key, value in plan.items() if key not in {"digest", "generatedAt"}}
    return hashlib.sha256(canonical_json(stable).encode("utf-8")).hexdigest()


class RemovalHandler(Protocol):
    kind: str

    def preview(self, workspace: Path, resource_id: str) -> dict[str, Any]: ...

    def execute(
        self, workspace: Path, resource_id: str, expected_digest: str
    ) -> dict[str, Any]: ...

    def verify(self, workspace: Path, resource_id: str) -> dict[str, Any]: ...


class VideoRemovalHandler:
    kind = "video"

    def job_directory(self, workspace: Path, video_id: str) -> Path:
        validate_video_id(video_id)
        job_directory = workspace / "jobs" / video_id
        if job_directory.parent != workspace / "jobs":
            raise RemovalError("resolved job escaped the workspace jobs directory")
        return job_directory

    def preview(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id = validate_video_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        if not job_directory.exists():
            raise RemovalError(f"video job not found: {job_directory}")
        if job_directory.is_symlink() or not job_directory.is_dir():
            raise RemovalError(f"video job is not a regular directory: {job_directory}")

        status, status_error = read_status(job_directory)
        state = str(status.get("state") or "unknown")
        process = status.get("process") if isinstance(status.get("process"), dict) else {}
        pid = process.get("pid") if isinstance(process, dict) else None
        active_process = {
            "state": state,
            "pid": pid if isinstance(pid, int) and not isinstance(pid, bool) else None,
            "alive": process_is_alive(pid),
        }
        filesystem = filesystem_inventory(workspace, job_directory)
        database = inspect_database(workspace / "app.db", video_id)
        blocked: list[dict[str, object]] = []
        warnings: list[dict[str, str]] = []

        if active_process["alive"]:
            blocked.append(
                {
                    "code": "active-process",
                    "message": "the job has a live processing command; stop it and create a new preview",
                    "pid": active_process["pid"],
                    "state": state,
                }
            )
        status_video_id = status.get("videoId")
        if status_video_id is not None and status_video_id != video_id:
            blocked.append(
                {
                    "code": "resource-identity-mismatch",
                    "message": "status.json videoId does not match the selected job directory",
                    "statusVideoId": status_video_id,
                    "directoryVideoId": video_id,
                }
            )
        if filesystem["symlinks"]:
            blocked.append(
                {
                    "code": "unsafe-filesystem-entry",
                    "message": "the job contains symbolic links or non-regular entries",
                    "paths": filesystem["symlinks"],
                }
            )
        if database["error"]:
            blocked.append(
                {
                    "code": "database-inspection-failed",
                    "message": database["error"],
                }
            )
        if database["unsafeReferences"]:
            blocked.append(
                {
                    "code": "unsafe-database-reference",
                    "message": "one or more job relations do not use ON DELETE CASCADE",
                    "references": database["unsafeReferences"],
                }
            )
        if status_error:
            warnings.append({"code": "status-unreadable", "message": status_error})
        if database["exists"] and not database["jobsTable"] and not database["error"]:
            warnings.append(
                {
                    "code": "jobs-table-missing",
                    "message": "app.db exists but does not contain the jobs projection table",
                }
            )

        plan: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": {
                "kind": self.kind,
                "videoId": video_id,
                "title": str(status.get("title") or video_id),
            },
            "workspace": str(workspace),
            "generatedAt": utc_now(),
            "filesystem": filesystem,
            "database": database,
            "state": state,
            "activeProcess": active_process,
            "dependencyPolicy": "cascade-all-owned",
            "removes": [
                "the complete workspace-owned video job directory",
                "video, thumbnail, captions, subtitle work, summaries, notes, playback state, status, history, and logs owned by this job",
                "the app.db jobs row and every ON DELETE CASCADE relation owned by this job",
            ],
            "preserves": [
                "the INSU Player runtime and models",
                "all other video jobs and their data",
                "repository source files",
            ],
            "recoverability": {
                "mode": "permanent",
                "message": "confirmed execution permanently removes the selected job; recreate it from the authorized source or a separate backup",
            },
            "blocked": blocked,
            "warnings": warnings,
        }
        plan["digest"] = plan_digest(plan)
        return plan

    def execute(
        self, workspace: Path, resource_id: str, expected_digest: str
    ) -> dict[str, Any]:
        video_id = validate_video_id(resource_id)
        plan = self.preview(workspace, video_id)
        actual_digest = str(plan["digest"])
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise RemovalError("plan digest must be a 64-character lowercase SHA-256 value")
        if expected_digest != actual_digest:
            raise RemovalError(
                f"removal plan is stale: expected {expected_digest}, current {actual_digest}; preview again"
            )
        if plan["blocked"]:
            raise RemovalError("removal plan is blocked; resolve every blocker and preview again")

        job_directory = self.job_directory(workspace, video_id)
        staging = workspace / "jobs" / f".removing-{video_id}-{actual_digest[:12]}"
        if staging.exists() or staging.is_symlink():
            raise RemovalError(f"staging target already exists: {staging}")

        database_path = workspace / "app.db"
        connection: sqlite3.Connection | None = None
        os.replace(job_directory, staging)
        try:
            if plan["database"]["exists"] and plan["database"]["jobsTable"]:
                connection = sqlite3.connect(database_path, timeout=10)
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("BEGIN IMMEDIATE")
                connection.execute('DELETE FROM "jobs" WHERE "video_id" = ?', (video_id,))
                connection.commit()
            shutil.rmtree(staging)
        except Exception:
            if connection is not None and connection.in_transaction:
                connection.rollback()
            if staging.exists() and not job_directory.exists():
                os.replace(staging, job_directory)
            raise
        finally:
            if connection is not None:
                connection.close()

        verification = self.verify(workspace, video_id)
        if not verification["removed"]:
            raise RemovalError("execution finished but verification found retained job data")
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": plan["target"],
            "workspace": str(workspace),
            "planDigest": actual_digest,
            "executedAt": utc_now(),
            "recoverability": plan["recoverability"],
            "verification": verification,
        }

    def verify(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id = validate_video_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        staging_prefix = f".removing-{video_id}-"
        staging = sorted(
            entry.name
            for entry in (workspace / "jobs").iterdir()
            if entry.name.startswith(staging_prefix)
        )
        database = inspect_database(workspace / "app.db", video_id)
        retained_rows = sum(int(row["rows"]) for row in database["rows"])
        removed = (
            not job_directory.exists()
            and not staging
            and database["error"] is None
            and retained_rows == 0
        )
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "verify-removal",
            "target": {"kind": self.kind, "videoId": video_id},
            "workspace": str(workspace),
            "checkedAt": utc_now(),
            "jobDirectoryExists": job_directory.exists(),
            "stagingDirectories": staging,
            "databaseRows": database["rows"],
            "databaseError": database["error"],
            "removed": removed,
        }


class SubtitleArtifactRemovalHandler:
    kind = "subtitle-artifact"

    def parse_resource_id(self, resource_id: str) -> tuple[str, str]:
        video_id, separator, artifact_id = resource_id.partition(":")
        if not separator:
            raise RemovalError("subtitle artifact target is incomplete")
        return validate_video_id(video_id), validate_artifact_id(artifact_id)

    def job_directory(self, workspace: Path, video_id: str) -> Path:
        directory = workspace / "jobs" / video_id
        if directory.parent != workspace / "jobs":
            raise RemovalError("resolved subtitle job escaped the workspace")
        if not directory.is_dir() or directory.is_symlink():
            raise RemovalError(f"video job not found: {directory}")
        return directory

    def artifacts(self, job_directory: Path, status: dict[str, Any]) -> list[dict[str, Any]]:
        if status.get("schemaVersion") != 6:
            raise RemovalError("subtitle status must use schemaVersion 6")
        raw = status.get("subtitleArtifacts")
        if not isinstance(raw, list) or not all(isinstance(artifact, dict) for artifact in raw):
            raise RemovalError("subtitle status must contain subtitleArtifacts")
        return raw

    def cascade_ids(
        self, artifacts: list[dict[str, Any]], artifact_id: str
    ) -> set[str]:
        ids = {
            str(artifact.get("id"))
            for artifact in artifacts
            if isinstance(artifact.get("id"), str)
        }
        if artifact_id not in ids:
            raise RemovalError(f"subtitle artifact not found: {artifact_id}")
        removed = {artifact_id}
        changed = True
        while changed:
            changed = False
            for artifact in artifacts:
                candidate_id = artifact.get("id")
                dependencies = artifact.get("dependencies")
                if not isinstance(candidate_id, str) or candidate_id in removed:
                    continue
                dependency_ids = {
                    dependency.get("artifactId")
                    for dependency in dependencies
                    if isinstance(dependency, dict)
                    and isinstance(dependency.get("artifactId"), str)
                } if isinstance(dependencies, list) else set()
                if dependency_ids.intersection(removed):
                    removed.add(candidate_id)
                    changed = True
        return removed

    def owned_paths(
        self,
        job_directory: Path,
        artifacts: list[dict[str, Any]],
        removed_ids: set[str],
    ) -> tuple[list[Path], list[dict[str, str]]]:
        survivor_paths: set[str] = set()
        removed_paths: set[str] = set()
        blocked: list[dict[str, str]] = []
        for artifact in artifacts:
            artifact_id = artifact.get("id")
            paths: list[tuple[str, str]] = []
            raw_manifest = artifact.get("manifestPath")
            if isinstance(raw_manifest, str):
                paths.append((raw_manifest, "manifest"))
            raw_tracks = artifact.get("tracks")
            if isinstance(raw_tracks, list):
                for raw_track in raw_tracks:
                    if not isinstance(raw_track, dict):
                        continue
                    raw_path = raw_track.get("path")
                    if isinstance(raw_path, str):
                        paths.append((raw_path, "track"))
            target = removed_paths if artifact_id in removed_ids else survivor_paths
            for raw_path, path_kind in paths:
                candidate = (job_directory / raw_path).resolve()
                try:
                    relative = candidate.relative_to(job_directory.resolve())
                except ValueError:
                    blocked.append(
                        {
                            "code": "unsafe-subtitle-path",
                            "message": "subtitle artifact path escaped its job directory",
                        }
                    )
                    continue
                permitted = (
                    path_kind == "track"
                    and candidate.suffix == ".vtt"
                    and len(relative.parts) >= 4
                    and relative.parts[:3] == ("subtitle-work", "artifacts", str(artifact_id))
                ) or (
                    path_kind == "manifest"
                    and candidate.suffix == ".json"
                    and len(relative.parts) >= 4
                    and relative.parts[:3] == ("subtitle-work", "artifacts", str(artifact_id))
                )
                if not permitted:
                    blocked.append(
                        {
                            "code": "unsafe-subtitle-path",
                            "message": "subtitle artifact owns an unsupported path",
                        }
                    )
                    continue
                target.add(relative.as_posix())
        paths = []
        for relative in sorted(removed_paths - survivor_paths):
            candidate = job_directory / relative
            if candidate.exists():
                if candidate.is_symlink() or not candidate.is_file():
                    blocked.append(
                        {
                            "code": "unsafe-subtitle-path",
                            "message": "subtitle artifact contains a non-regular file",
                        }
                    )
                else:
                    paths.append(candidate)
        registered_removed_paths = {
            candidate.relative_to(job_directory).as_posix() for candidate in paths
        }
        for artifact_id in sorted(removed_ids):
            artifact_directory = (
                job_directory / "subtitle-work" / "artifacts" / artifact_id
            )
            if not artifact_directory.exists():
                continue
            if artifact_directory.is_symlink() or not artifact_directory.is_dir():
                blocked.append(
                    {
                        "code": "unsafe-subtitle-directory",
                        "message": "subtitle artifact directory is not a regular directory",
                    }
                )
                continue
            for candidate in artifact_directory.rglob("*"):
                if candidate.is_symlink():
                    blocked.append(
                        {
                            "code": "unsafe-subtitle-path",
                            "message": "subtitle artifact directory contains a symlink",
                        }
                    )
                    continue
                if candidate.is_file():
                    relative = candidate.relative_to(job_directory).as_posix()
                    if relative not in registered_removed_paths:
                        blocked.append(
                            {
                                "code": "unregistered-subtitle-file",
                                "message": "subtitle artifact directory contains an unregistered file",
                            }
                        )
        return paths, blocked

    def preview(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id, artifact_id = self.parse_resource_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        status, status_error = read_status(job_directory)
        if status_error:
            raise RemovalError(f"subtitle status is unreadable: {status_error}")
        artifacts = self.artifacts(job_directory, status)
        removed_ids = self.cascade_ids(artifacts, artifact_id)
        owned_paths, blocked = self.owned_paths(
            job_directory, artifacts, removed_ids
        )
        process = status.get("process") if isinstance(status.get("process"), dict) else {}
        pid = process.get("pid") if isinstance(process, dict) else None
        if process_is_alive(pid):
            blocked.append(
                {
                    "code": "active-process",
                    "message": "the job has a live processing command",
                }
            )
        path_inventory = [
            {
                "path": candidate.relative_to(workspace).as_posix(),
                "bytes": candidate.stat().st_size,
                "mtimeNs": candidate.stat().st_mtime_ns,
            }
            for candidate in owned_paths
        ]
        status_path = job_directory / "status.json"
        plan: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": {
                "kind": self.kind,
                "videoId": video_id,
                "artifactId": artifact_id,
            },
            "workspace": str(workspace),
            "generatedAt": utc_now(),
            "statusFingerprint": hashlib.sha256(
                status_path.read_bytes()
            ).hexdigest(),
            "removedArtifactIds": sorted(removed_ids),
            "files": path_inventory,
            "dependencyPolicy": "cascade-dependent-subtitle-artifacts",
            "blocked": blocked,
            "warnings": [],
        }
        plan["digest"] = plan_digest(plan)
        return plan

    def clear_projection(self, workspace: Path, video_id: str) -> None:
        database_path = workspace / "app.db"
        if not database_path.exists():
            return
        connection = sqlite3.connect(database_path, timeout=10)
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            tables = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            connection.execute("BEGIN IMMEDIATE")
            for table in (
                "active_subtitle_tracks",
                "subtitle_runs",
                "subtitle_artifact_tracks",
                "subtitle_artifacts",
            ):
                if table in tables:
                    connection.execute(
                        f'DELETE FROM {safe_identifier(table)} WHERE "video_id" = ?',
                        (video_id,),
                    )
            connection.commit()
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise
        finally:
            connection.close()

    def execute(
        self, workspace: Path, resource_id: str, expected_digest: str
    ) -> dict[str, Any]:
        video_id, artifact_id = self.parse_resource_id(resource_id)
        plan = self.preview(workspace, resource_id)
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise RemovalError("plan digest must be a lowercase SHA-256 value")
        if expected_digest != plan["digest"]:
            raise RemovalError("removal plan is stale; preview again")
        if plan["blocked"]:
            raise RemovalError("removal plan is blocked")

        job_directory = self.job_directory(workspace, video_id)
        status_path = job_directory / "status.json"
        original_status = status_path.read_bytes()
        status = json.loads(original_status)
        artifacts = self.artifacts(job_directory, status)
        removed_ids = set(plan["removedArtifactIds"])
        survivors = [
            artifact
            for artifact in artifacts
            if artifact.get("id") not in removed_ids
        ]
        removed_track_ids = {
            track.get("id")
            for artifact in artifacts
            if artifact.get("id") in removed_ids
            for track in artifact.get("tracks", [])
            if isinstance(track, dict) and isinstance(track.get("id"), str)
        }
        active = status.get("activeSubtitleTracks")
        if isinstance(active, dict):
            status["activeSubtitleTracks"] = {
                language: track_id
                for language, track_id in active.items()
                if track_id not in removed_track_ids
            }
        status["subtitleArtifacts"] = survivors
        removed_relative_paths = {
            (workspace / str(raw_file["path"])).relative_to(job_directory).as_posix()
            for raw_file in plan["files"]
        }
        assets = status.get("assets")
        if isinstance(assets, dict):
            status["assets"] = {
                name: metadata
                for name, metadata in assets.items()
                if not (
                    isinstance(metadata, dict)
                    and metadata.get("path") in removed_relative_paths
                )
            }

        survivor_kinds = {
            artifact.get("kind")
            for artifact in survivors
            if isinstance(artifact.get("kind"), str)
        }
        pipeline = status.get("subtitlePipeline")
        pipeline_mode = (
            str(pipeline.get("mode"))
            if isinstance(pipeline, dict)
            else "proofread"
        )
        if "segmentation" in survivor_kinds:
            state, stage, message = "ready", "complete", "切分字幕已完成"
            if isinstance(pipeline, dict):
                pipeline["stage"] = "complete"
        elif survivor_kinds.intersection({"proofread", "translation"}):
            state, stage, message = (
                "needs_segmentation",
                "target_segmentation",
                "完整句字幕可觀看，等待重新建立切分字幕",
            )
            if isinstance(pipeline, dict):
                pipeline["stage"] = "content_complete"
        elif "source" in survivor_kinds:
            has_model_source = any(
                artifact.get("kind") == "source"
                and artifact.get("sourceType") == "model-transcript"
                for artifact in survivors
            )
            if has_model_source:
                state = "needs_translation" if pipeline_mode == "translate" else "needs_proofreading"
                state_label = "翻譯" if pipeline_mode == "translate" else "校正"
                stage, message = "content_revision", f"等待重新建立{state_label}字幕"
                if isinstance(pipeline, dict):
                    pipeline["stage"] = "content_revision"
            else:
                state, stage, message = (
                    "needs_transcription",
                    "model_transcription",
                    "人工 CC 可觀看，等待重新建立模型時間軸",
                )
                if isinstance(pipeline, dict):
                    pipeline["stage"] = "awaiting_model"
        else:
            state, stage, message = (
                "needs_transcription",
                "awaiting_model",
                "字幕已移除，可重新轉錄",
            )
            if isinstance(pipeline, dict):
                pipeline["stage"] = "awaiting_model"
        now = utc_now()
        status.update(
            {
                "state": state,
                "stage": stage,
                "message": message,
                "completedAt": now if state == "ready" else None,
                "updatedAt": now,
            }
        )
        history = status.setdefault("history", [])
        if isinstance(history, list):
            history.append(
                {
                    "at": now,
                    "state": state,
                    "stage": stage,
                    "message": message,
                }
            )

        staging = job_directory / f".removing-subtitle-{expected_digest[:12]}"
        if staging.exists() or staging.is_symlink():
            raise RemovalError("subtitle removal staging directory already exists")
        staging.mkdir()
        moved: list[tuple[Path, Path]] = []
        try:
            for raw_file in plan["files"]:
                candidate = workspace / str(raw_file["path"])
                relative = candidate.relative_to(job_directory)
                staged = staging / relative
                staged.parent.mkdir(parents=True, exist_ok=True)
                os.replace(candidate, staged)
                moved.append((staged, candidate))
            for removed_id in sorted(removed_ids):
                artifact_directory = (
                    job_directory / "subtitle-work" / "artifacts" / removed_id
                )
                if not artifact_directory.exists():
                    continue
                nested_directories = sorted(
                    (
                        candidate
                        for candidate in artifact_directory.rglob("*")
                        if candidate.is_dir()
                    ),
                    key=lambda candidate: len(candidate.parts),
                    reverse=True,
                )
                for directory in nested_directories:
                    directory.rmdir()
                artifact_directory.rmdir()
            atomic_write_json(status_path, status)
            self.clear_projection(workspace, video_id)
            shutil.rmtree(staging)
        except Exception:
            status_path.write_bytes(original_status)
            for staged, original in reversed(moved):
                if staged.exists():
                    original.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(staged, original)
            if staging.exists():
                shutil.rmtree(staging)
            raise

        verification = self.verify(workspace, resource_id)
        retained_artifact_directories = [
            removed_id
            for removed_id in removed_ids
            if (
                job_directory
                / "subtitle-work"
                / "artifacts"
                / removed_id
            ).exists()
        ]
        if retained_artifact_directories:
            raise RemovalError("subtitle artifact directories were not removed")
        if not verification["removed"]:
            raise RemovalError("subtitle artifact removal verification failed")
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": plan["target"],
            "workspace": str(workspace),
            "planDigest": expected_digest,
            "executedAt": utc_now(),
            "verification": verification,
        }

    def verify(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id, artifact_id = self.parse_resource_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        status, status_error = read_status(job_directory)
        artifacts = status.get("subtitleArtifacts") if not status_error else None
        artifact_ids = {
            artifact.get("id")
            for artifact in artifacts
            if isinstance(artifact, dict)
        } if isinstance(artifacts, list) else set()
        staging = list(job_directory.glob(".removing-subtitle-*"))
        artifact_directory = (
            job_directory / "subtitle-work" / "artifacts" / artifact_id
        )
        database_rows = 0
        database_path = workspace / "app.db"
        if database_path.exists():
            connection = database_connection_readonly(database_path)
            try:
                tables = {
                    str(row[0])
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                if "subtitle_artifacts" in tables:
                    database_rows = int(
                        connection.execute(
                            'SELECT COUNT(*) FROM "subtitle_artifacts" WHERE "id" = ?',
                            (f"{video_id}:{artifact_id}",),
                        ).fetchone()[0]
                    )
            finally:
                connection.close()
        removed = (
            status_error is None
            and artifact_id not in artifact_ids
            and not artifact_directory.exists()
            and not staging
            and database_rows == 0
        )
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "verify-removal",
            "target": {
                "kind": self.kind,
                "videoId": video_id,
                "artifactId": artifact_id,
            },
            "checkedAt": utc_now(),
            "statusError": status_error,
            "stagingDirectories": [candidate.name for candidate in staging],
            "artifactDirectoryExists": artifact_directory.exists(),
            "databaseRows": database_rows,
            "removed": removed,
        }


class MediaRenditionRemovalHandler:
    kind = "media-rendition"

    def parse_resource_id(self, resource_id: str) -> tuple[str, str]:
        video_id, separator, rendition_id = resource_id.partition(":")
        if not separator:
            raise RemovalError("media rendition target is incomplete")
        return validate_video_id(video_id), validate_rendition_id(rendition_id)

    def job_directory(self, workspace: Path, video_id: str) -> Path:
        directory = workspace / "jobs" / video_id
        if directory.parent != workspace / "jobs":
            raise RemovalError("resolved media job escaped the workspace")
        if not directory.is_dir() or directory.is_symlink():
            raise RemovalError(f"video job not found: {directory}")
        return directory

    def read_catalog(self, job_directory: Path, video_id: str) -> tuple[Path, dict[str, Any]]:
        catalog_path = job_directory / "media-work" / "catalog.json"
        if not catalog_path.is_file() or catalog_path.is_symlink():
            raise RemovalError("media catalog is unavailable")
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
        if (
            not isinstance(payload, dict)
            or payload.get("schemaVersion") != 1
            or payload.get("videoId") != video_id
            or not isinstance(payload.get("renditions"), list)
        ):
            raise RemovalError("media catalog is invalid")
        return catalog_path, payload

    def rendition_file(
        self, job_directory: Path, rendition_id: str, rendition: dict[str, Any]
    ) -> Path:
        raw_path = rendition.get("path")
        if not isinstance(raw_path, str):
            raise RemovalError("media rendition path is invalid")
        relative = Path(raw_path)
        expected = Path("source") / "renditions" / f"{rendition_id}.mp4"
        if relative != expected or relative.is_absolute() or ".." in relative.parts:
            raise RemovalError("media rendition path is outside its owned location")
        candidate = job_directory / relative
        if not candidate.is_file() or candidate.is_symlink():
            raise RemovalError("media rendition file is unavailable or unsafe")
        return candidate

    def database_rows(self, workspace: Path, video_id: str, rendition_id: str) -> int:
        database_path = workspace / "app.db"
        if not database_path.exists():
            return 0
        connection = database_connection_readonly(database_path)
        try:
            tables = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            if "media_renditions" not in tables:
                return 0
            return int(
                connection.execute(
                    'SELECT COUNT(*) FROM "media_renditions" WHERE "video_id" = ? AND "id" = ?',
                    (video_id, rendition_id),
                ).fetchone()[0]
            )
        finally:
            connection.close()

    def preview(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id, rendition_id = self.parse_resource_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        _, catalog = self.read_catalog(job_directory, video_id)
        rendition = next(
            (
                item
                for item in catalog["renditions"]
                if isinstance(item, dict) and item.get("id") == rendition_id
            ),
            None,
        )
        if not isinstance(rendition, dict):
            raise RemovalError("media rendition not found")
        candidate = self.rendition_file(job_directory, rendition_id, rendition)
        metadata = candidate.stat(follow_symlinks=False)
        blocked: list[dict[str, object]] = []
        operation = catalog.get("operation")
        if catalog.get("activeRenditionId") == rendition_id:
            blocked.append(
                {
                    "code": "active-rendition",
                    "message": "switch to another downloaded quality before removing the active rendition",
                }
            )
        if isinstance(operation, dict) and operation.get("state") in {
            "discovering",
            "probing",
            "downloading",
            "merging",
            "validating",
        } and process_is_alive(operation.get("pid")):
            blocked.append(
                {
                    "code": "active-process",
                    "message": "a media quality operation is still active",
                    "pid": operation.get("pid"),
                }
            )
        plan: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": {
                "kind": self.kind,
                "videoId": video_id,
                "renditionId": rendition_id,
                "height": rendition.get("height"),
            },
            "workspace": str(workspace),
            "generatedAt": utc_now(),
            "file": {
                "path": candidate.relative_to(workspace).as_posix(),
                "bytes": metadata.st_size,
                "mtimeNs": metadata.st_mtime_ns,
                "checksum": rendition.get("checksum"),
            },
            "catalogRevision": catalog.get("revision"),
            "databaseRows": self.database_rows(workspace, video_id, rendition_id),
            "dependencyPolicy": "preserve-video-and-other-renditions",
            "blocked": blocked,
            "warnings": [],
        }
        plan["digest"] = plan_digest(plan)
        return plan

    def execute(
        self, workspace: Path, resource_id: str, expected_digest: str
    ) -> dict[str, Any]:
        video_id, rendition_id = self.parse_resource_id(resource_id)
        plan = self.preview(workspace, resource_id)
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise RemovalError("plan digest must be a 64-character lowercase SHA-256 value")
        if plan["digest"] != expected_digest:
            raise RemovalError("removal plan is stale; preview again")
        if plan["blocked"]:
            raise RemovalError("removal plan is blocked; resolve every blocker and preview again")

        job_directory = self.job_directory(workspace, video_id)
        catalog_path, catalog = self.read_catalog(job_directory, video_id)
        rendition = next(
            item
            for item in catalog["renditions"]
            if isinstance(item, dict) and item.get("id") == rendition_id
        )
        candidate = self.rendition_file(job_directory, rendition_id, rendition)
        staging = job_directory / "media-work" / f".removing-rendition-{expected_digest[:12]}.mp4"
        if staging.exists() or staging.is_symlink():
            raise RemovalError("media rendition removal staging file already exists")
        original_catalog = catalog_path.read_bytes()
        connection: sqlite3.Connection | None = None
        os.replace(candidate, staging)
        try:
            catalog["renditions"] = [
                item
                for item in catalog["renditions"]
                if not isinstance(item, dict) or item.get("id") != rendition_id
            ]
            catalog["revision"] = int(catalog.get("revision") or 0) + 1
            atomic_write_json(catalog_path, catalog)
            database_path = workspace / "app.db"
            if database_path.exists():
                connection = sqlite3.connect(database_path, timeout=10)
                tables = {
                    str(row[0])
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                if "media_renditions" in tables:
                    connection.execute(
                        'DELETE FROM "media_renditions" WHERE "video_id" = ? AND "id" = ?',
                        (video_id, rendition_id),
                    )
                    connection.commit()
            staging.unlink()
        except Exception:
            if connection is not None and connection.in_transaction:
                connection.rollback()
            catalog_path.write_bytes(original_catalog)
            if staging.exists() and not candidate.exists():
                os.replace(staging, candidate)
            raise
        finally:
            if connection is not None:
                connection.close()

        verification = self.verify(workspace, resource_id)
        if not verification["removed"]:
            raise RemovalError("media rendition removal verification failed")
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "remove",
            "target": plan["target"],
            "workspace": str(workspace),
            "planDigest": expected_digest,
            "executedAt": utc_now(),
            "verification": verification,
        }

    def verify(self, workspace: Path, resource_id: str) -> dict[str, Any]:
        video_id, rendition_id = self.parse_resource_id(resource_id)
        job_directory = self.job_directory(workspace, video_id)
        _, catalog = self.read_catalog(job_directory, video_id)
        registered = any(
            isinstance(item, dict) and item.get("id") == rendition_id
            for item in catalog["renditions"]
        )
        candidate = job_directory / "source" / "renditions" / f"{rendition_id}.mp4"
        staging = list((job_directory / "media-work").glob(".removing-rendition-*.mp4"))
        database_rows = self.database_rows(workspace, video_id, rendition_id)
        removed = not registered and not candidate.exists() and not staging and database_rows == 0
        return {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "verify-removal",
            "target": {
                "kind": self.kind,
                "videoId": video_id,
                "renditionId": rendition_id,
            },
            "checkedAt": utc_now(),
            "registered": registered,
            "fileExists": candidate.exists(),
            "stagingFiles": [item.name for item in staging],
            "databaseRows": database_rows,
            "removed": removed,
        }


HANDLERS: dict[str, RemovalHandler] = {
    "video": VideoRemovalHandler(),
    "subtitle-artifact": SubtitleArtifactRemovalHandler(),
    "media-rendition": MediaRenditionRemovalHandler(),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely remove one resource owned by an INSU Player workspace"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_target(command: str) -> argparse.ArgumentParser:
        subparser = subparsers.add_parser(command)
        subparser.add_argument("workspace")
        subparser.add_argument("--kind", choices=sorted(HANDLERS), required=True)
        subparser.add_argument("--video-id", required=True)
        subparser.add_argument("--artifact-id")
        subparser.add_argument("--rendition-id")
        return subparser

    add_target("preview")
    execute = add_target("execute")
    execute.add_argument("--plan-digest", required=True)
    execute.add_argument("--yes", action="store_true")
    add_target("verify")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        workspace = resolve_workspace(args.workspace)
        handler = HANDLERS[args.kind]
        if args.kind == "subtitle-artifact":
            if not args.artifact_id:
                raise RemovalError("subtitle artifact removal requires --artifact-id")
            if args.rendition_id:
                raise RemovalError("--rendition-id is not valid for subtitle artifacts")
            resource_id = f"{args.video_id}:{args.artifact_id}"
        elif args.kind == "media-rendition":
            if not args.rendition_id:
                raise RemovalError("media rendition removal requires --rendition-id")
            if args.artifact_id:
                raise RemovalError("--artifact-id is not valid for media renditions")
            resource_id = f"{args.video_id}:{args.rendition_id}"
        else:
            if args.artifact_id or args.rendition_id:
                raise RemovalError("resource-specific IDs are not valid for video removal")
            resource_id = args.video_id
        if args.command == "preview":
            print_json(handler.preview(workspace, resource_id))
        elif args.command == "execute":
            if not args.yes:
                raise RemovalError(
                    "execute requires --yes after the user explicitly confirms the current plan digest"
                )
            print_json(
                handler.execute(workspace, resource_id, str(args.plan_digest))
            )
        elif args.command == "verify":
            verification = handler.verify(workspace, resource_id)
            print_json(verification)
            return 0 if verification["removed"] else 1
        return 0
    except (OSError, RemovalError, sqlite3.Error) as error:
        print_json({"error": str(error), "command": args.command})
        return 1


if __name__ == "__main__":
    sys.exit(main())
