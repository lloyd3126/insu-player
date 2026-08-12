#!/usr/bin/env python3
"""Preview, execute, and verify a current-project INSU Player library reset."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 8
DATA_TABLES = (
    "agent_intents",
    "active_subtitle_tracks",
    "active_summary_artifacts",
    "download_queue_items",
    "download_queue_settings",
    "extension_pairings",
    "extension_pairing_invitations",
    "job_assets",
    "job_history",
    "local_media_imports",
    "media_items",
    "media_sources",
    "local_model_download_runs",
    "media_download_runs",
    "media_renditions",
    "note_anchors",
    "notes",
    "operation_events",
    "operations",
    "playback_states",
    "runtime_capabilities",
    "transcription_settings",
    "subtitle_artifact_dependencies",
    "subtitle_artifact_tracks",
    "subtitle_artifacts",
    "subtitle_pipelines",
    "subtitle_runs",
    "subtitle_style_presets",
    "subtitle_style_settings",
    "summary_artifacts",
    "summary_dependencies",
    "tag_assignments",
    "tags",
)
BOOTSTRAP_TABLES = {
    "download_queue_settings",
    "runtime_capabilities",
    "transcription_settings",
}
DATABASE_FILES = ("app.db", "app.db-wal", "app.db-shm")
SESSION_FILES = (
    ".insu-player-server.json",
    ".insu-player-server.pid",
    ".insu-provider-session.json",
    ".insu-player-migration-input.json",
)
TRANSIENT_SESSION_DIRECTORIES = (
    ".agent-tools/insu-player/tmp/cookie-sessions",
    ".agent-tools/insu-player/tmp/imports",
)
REMOVED_DIRECTORIES = (
    ".insu-player-migrations",
)
CANONICAL_MODEL_NAMES = (
    "tiny", "tiny.en", "base", "base.en", "small", "small.en",
    "medium", "medium.en", "large-v1", "large-v2", "large-v3",
    "large-v3-turbo",
)
API_KEY_NAMES = (
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
    "XAI_API_KEY",
    "OPENROUTER_API_KEY",
)


class ResetError(RuntimeError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


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
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def resolve_scope(project_root_input: str, workspace_input: str) -> tuple[Path, Path]:
    project_root = Path(project_root_input).expanduser().resolve()
    if not project_root.is_dir() or not (project_root / "AGENTS.md").is_file():
        raise ResetError(f"project root is not an INSU Player checkout: {project_root}")
    expected_workspace = project_root / ".local" / "insu-player"
    if expected_workspace.is_symlink():
        raise ResetError(f"workspace must not be a symlink: {expected_workspace}")
    workspace = Path(workspace_input).expanduser().resolve()
    if workspace != expected_workspace.resolve():
        raise ResetError(
            "workspace must be the current project's exact .local/insu-player directory"
        )
    if not workspace.is_dir():
        raise ResetError(f"workspace not found: {workspace}")
    jobs = workspace / "jobs"
    if not jobs.is_dir() or jobs.is_symlink():
        raise ResetError(f"workspace jobs directory is missing or unsafe: {jobs}")
    return project_root, workspace


def inspect_tree(workspace: Path, root: Path) -> dict[str, Any]:
    entries: list[dict[str, object]] = []
    unsafe: list[str] = []
    file_count = 0
    total_bytes = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
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
            entries.append({"path": relative, "type": "directory"})
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
        "path": root.relative_to(workspace).as_posix(),
        "directories": sum(1 for entry in entries if entry["type"] == "directory"),
        "files": file_count,
        "bytes": total_bytes,
        "fingerprint": fingerprint,
        "unsafeEntries": unsafe,
    }


def inspect_database(path: Path) -> dict[str, Any]:
    if path.is_symlink():
        return {
            "exists": True,
            "tables": {},
            "missingTables": list(DATA_TABLES),
            "error": "app.db is a symlink",
        }
    if not path.exists():
        return {
            "exists": False,
            "tables": {},
            "missingTables": list(DATA_TABLES),
            "error": None,
        }
    if not path.is_file():
        return {
            "exists": True,
            "tables": {},
            "missingTables": list(DATA_TABLES),
            "error": "app.db is not a regular file",
        }
    try:
        connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
        try:
            existing = {
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            counts = {
                table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
                for table in DATA_TABLES
                if table in existing
            }
            return {
                "exists": True,
                "tables": counts,
                "missingTables": sorted(set(DATA_TABLES) - existing),
                "error": None,
            }
        finally:
            connection.close()
    except sqlite3.Error as error:
        return {
            "exists": True,
            "tables": {},
            "missingTables": list(DATA_TABLES),
            "error": str(error),
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


def inspect_api_keys(workspace: Path) -> dict[str, Any]:
    descriptor = load_json(workspace / ".insu-player-server.json") or {}
    pid = descriptor.get("pid")
    if not process_is_alive(pid):
        return {
            "state": "no-live-server",
            "configuredNames": [],
            "cleared": True,
        }
    host = descriptor.get("host")
    port = descriptor.get("port")
    if host not in {"127.0.0.1", "localhost", "::1"} or not isinstance(port, int):
        return {
            "state": "unavailable",
            "configuredNames": [],
            "cleared": False,
            "error": "live server descriptor has an invalid endpoint",
        }
    connection: http.client.HTTPConnection | None = None
    try:
        connection = http.client.HTTPConnection(host, port, timeout=2)
        connection.request("GET", "/api/models")
        response = connection.getresponse()
        if response.status != 200:
            raise ResetError(f"model catalog returned HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8"))
        providers = payload.get("providers") if isinstance(payload, dict) else None
        if not isinstance(providers, list):
            raise ResetError("model catalog has an invalid provider shape")
        configured = sorted(
            str(provider.get("credentialName"))
            for provider in providers
            if isinstance(provider, dict)
            and provider.get("credentialName") in API_KEY_NAMES
            and provider.get("configured") is True
        )
        return {
            "state": "live-server",
            "configuredNames": configured,
            "cleared": not configured,
        }
    except (OSError, ValueError, json.JSONDecodeError, ResetError) as error:
        return {
            "state": "unavailable",
            "configuredNames": [],
            "cleared": False,
            "error": str(error),
        }
    finally:
        if connection is not None:
            connection.close()


def inspect_live_jobs(workspace: Path) -> list[dict[str, object]]:
    active: list[dict[str, object]] = []
    database = workspace / "app.db"
    if not database.is_file() or database.is_symlink():
        return active
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
        rows = connection.execute(
            "SELECT video_id, record_json FROM media_items ORDER BY video_id"
        ).fetchall()
    except sqlite3.Error:
        return active
    finally:
        if connection is not None:
            connection.close()
    for video_id, record_json in rows:
        try:
            payload = json.loads(record_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        process = payload.get("process")
        if not isinstance(process, dict):
            continue
        pid = process.get("pid")
        if process_is_alive(pid):
            active.append(
                {
                    "videoId": str(video_id),
                    "pid": pid,
                    "state": payload.get("state"),
                }
            )
    return active


def build_plan(project_root: Path, workspace: Path) -> dict[str, Any]:
    jobs = inspect_tree(workspace, workspace / "jobs")
    transient_sessions = {
        relative: inspect_tree(workspace, workspace / relative)
        for relative in TRANSIENT_SESSION_DIRECTORIES
    }
    migration_archives = {
        relative: inspect_tree(workspace, workspace / relative)
        for relative in REMOVED_DIRECTORIES
    }
    database = inspect_database(workspace / "app.db")
    live_jobs = inspect_live_jobs(workspace)
    blocked: list[dict[str, object]] = []
    if jobs["unsafeEntries"]:
        blocked.append(
            {
                "code": "unsafe-workspace-entry",
                "paths": jobs["unsafeEntries"],
            }
        )
    for target_name in (*DATABASE_FILES, *SESSION_FILES):
        candidate = workspace / target_name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
            blocked.append({"code": "unsafe-reset-target", "path": target_name})
    for target_name in TRANSIENT_SESSION_DIRECTORIES:
        candidate = workspace / target_name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            blocked.append({"code": "unsafe-reset-target", "path": target_name})
    for target_name in REMOVED_DIRECTORIES:
        candidate = workspace / target_name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            blocked.append({"code": "unsafe-reset-target", "path": target_name})
    if database["error"]:
        blocked.append({"code": "database-inspection-failed", "message": database["error"]})
    if live_jobs:
        blocked.append({"code": "live-job-process", "jobs": live_jobs})

    stable = {
        "schemaVersion": SCHEMA_VERSION,
        "operation": "reset-current-project-library",
        "projectRoot": str(project_root),
        "workspace": str(workspace),
        "jobs": jobs,
        "database": database,
        "transientSessions": transient_sessions,
        "migrationArchives": migration_archives,
        "delete": [
            "jobs/**",
            *DATABASE_FILES,
            *SESSION_FILES,
            *(f"{name}/**" for name in TRANSIENT_SESSION_DIRECTORIES),
            *(f"{name}/**" for name in REMOVED_DIRECTORIES),
        ],
        "apiKeys": {
            "action": "clear all session-only API keys by stopping the server",
            "names": list(API_KEY_NAMES),
        },
        "preserve": [
            "repository code",
            ".agent-tools/**",
            ".agent-tools/insu-player/bun-runtime/**",
            ".agent-tools/insu-player/.venv/**",
            ".agent-tools/insu-player/models/**",
            "prompts.json",
        ],
        "preservedModelAction": "validate canonical Whisper checksums and publish current manifests",
        "blocked": blocked,
    }
    digest = hashlib.sha256(canonical_json(stable).encode("utf-8")).hexdigest()
    return {
        **stable,
        "server": inspect_server(workspace),
        "apiKeyInspection": inspect_api_keys(workspace),
        "requiresServerStopBeforeExecute": True,
        "digest": digest,
        "confirmation": f"確認重建 {digest}",
    }


def preview(args: argparse.Namespace) -> int:
    project_root, workspace = resolve_scope(args.project_root, args.workspace)
    print_json(build_plan(project_root, workspace))
    return 0


def execute(args: argparse.Namespace) -> int:
    if not args.yes:
        raise ResetError("execute requires --yes after the user confirms the exact digest")
    project_root, workspace = resolve_scope(args.project_root, args.workspace)
    plan = build_plan(project_root, workspace)
    if plan["digest"] != args.plan_digest:
        raise ResetError(
            f"reset plan changed, create a new preview and confirm digest {plan['digest']}"
        )
    if plan["blocked"]:
        raise ResetError("reset plan is blocked by unsafe or live workspace state")
    if plan["server"]["alive"]:
        raise ResetError("workspace server is still running, stop it before execute")

    models_dir = workspace / ".agent-tools" / "insu-player" / "models"
    model_files = [
        models_dir / f"{name}.pt"
        for name in CANONICAL_MODEL_NAMES
        if (models_dir / f"{name}.pt").is_file()
    ]
    validated_models: list[str] = []
    if model_files:
        python = workspace / ".agent-tools" / "insu-player" / ".venv" / "bin" / "python"
        validator = (
            project_root
            / "plugins"
            / "insu-player"
            / "skills"
            / "watch-video"
            / "scripts"
            / "validate-local-model.py"
        )
        if not python.is_file() or not os.access(python, os.X_OK) or not validator.is_file():
            raise ResetError("cannot validate preserved Whisper models before reset")
        result = subprocess.run(
            [
                str(python),
                str(validator),
                "--models-dir",
                str(models_dir),
                "--all",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        if result.returncode != 0:
            raise ResetError(f"preserved Whisper model validation failed: {result.stdout.strip()}")
        validated_models = [path.stem for path in model_files]

    for name in (*DATABASE_FILES, *SESSION_FILES):
        candidate = workspace / name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
            raise ResetError(f"reset target became unsafe after preview: {candidate}")

    jobs = workspace / "jobs"
    shutil.rmtree(jobs)
    jobs.mkdir(mode=0o755)
    for name in (*DATABASE_FILES, *SESSION_FILES):
        candidate = workspace / name
        if candidate.is_symlink():
            raise ResetError(f"refusing to remove symlink: {candidate}")
        if candidate.is_file():
            candidate.unlink()
    for name in TRANSIENT_SESSION_DIRECTORIES:
        candidate = workspace / name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            raise ResetError(f"refusing to remove unsafe transient directory: {candidate}")
        if candidate.is_dir():
            shutil.rmtree(candidate)
        candidate.mkdir(parents=True, mode=0o700)
    for name in REMOVED_DIRECTORIES:
        candidate = workspace / name
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_dir()):
            raise ResetError(f"refusing to remove unsafe migration directory: {candidate}")
        if candidate.is_dir():
            shutil.rmtree(candidate)

    print_json(
        {
            "schemaVersion": SCHEMA_VERSION,
            "operation": "reset-current-project-library",
            "status": "executed",
            "workspace": str(workspace),
            "digest": args.plan_digest,
            "validatedModels": validated_models,
            "next": "restart the workspace homepage and run verify",
        }
    )
    return 0


def verify(args: argparse.Namespace) -> int:
    _, workspace = resolve_scope(args.project_root, args.workspace)
    job_entries = sorted(path.name for path in (workspace / "jobs").iterdir())
    database = inspect_database(workspace / "app.db")
    nonzero_library_tables = {
        table: count
        for table, count in database["tables"].items()
        if table not in BOOTSTRAP_TABLES and isinstance(count, int) and count != 0
    }
    api_keys = inspect_api_keys(workspace)
    transient_sessions = {
        name: sorted(path.name for path in (workspace / name).iterdir())
        if (workspace / name).is_dir()
        else ["missing"]
        for name in TRANSIENT_SESSION_DIRECTORIES
    }
    remaining_migration_archives = [
        name for name in REMOVED_DIRECTORIES if (workspace / name).exists()
    ]
    valid = (
        not job_entries
        and database["exists"]
        and not database["error"]
        and not database.get("missingTables")
        and not nonzero_library_tables
        and api_keys["cleared"] is True
        and not any(transient_sessions.values())
        and not remaining_migration_archives
    )
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "operation": "reset-current-project-library",
        "valid": valid,
        "workspace": str(workspace),
        "jobCount": len(job_entries),
        "jobEntries": job_entries,
        "database": database,
        "bootstrapTables": {
            table: database["tables"].get(table, 0)
            for table in sorted(BOOTSTRAP_TABLES)
        },
        "apiKeys": api_keys,
        "transientSessions": transient_sessions,
        "remainingMigrationArchives": remaining_migration_archives,
        "preserved": {
            "agentTools": (workspace / ".agent-tools").is_dir(),
            "bunRuntime": (workspace / ".agent-tools/insu-player/bun-runtime").is_dir(),
            "whisperEnvironment": (workspace / ".agent-tools/insu-player/.venv").is_dir(),
            "models": (workspace / ".agent-tools/insu-player/models").is_dir(),
        },
    }
    print_json(result)
    if not valid:
        raise ResetError("library reset verification failed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("preview", "execute", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--project-root", required=True)
        subparser.add_argument("--workspace", required=True)
        if command == "execute":
            subparser.add_argument("--plan-digest", required=True)
            subparser.add_argument("--yes", action="store_true")
        subparser.set_defaults(handler={"preview": preview, "execute": execute, "verify": verify}[command])
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except ResetError as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    raise SystemExit(main())
