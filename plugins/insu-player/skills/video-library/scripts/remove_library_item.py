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


HANDLERS: dict[str, RemovalHandler] = {"video": VideoRemovalHandler()}


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
        if args.command == "preview":
            print_json(handler.preview(workspace, args.video_id))
        elif args.command == "execute":
            if not args.yes:
                raise RemovalError(
                    "execute requires --yes after the user explicitly confirms the current plan digest"
                )
            print_json(
                handler.execute(workspace, args.video_id, str(args.plan_digest))
            )
        elif args.command == "verify":
            verification = handler.verify(workspace, args.video_id)
            print_json(verification)
            return 0 if verification["removed"] else 1
        return 0
    except (OSError, RemovalError, sqlite3.Error) as error:
        print_json({"error": str(error), "command": args.command})
        return 1


if __name__ == "__main__":
    sys.exit(main())
