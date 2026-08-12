#!/usr/bin/env python3
"""Inspect one INSU Player job without mutating workflow state."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


ACTIVE_JOB_STATES = {
    "checking",
    "downloading",
    "transcribing",
    "proofreading",
    "translating",
    "segmenting",
    "preparing_player",
}
CONTINUABLE_JOB_STATES = {
    "downloaded",
    "needs_transcription",
    "needs_proofreading",
    "needs_translation",
    "needs_segmentation",
}
CONTINUABLE_NEXT_ACTIONS = {
    "downloaded": "ask-subtitle-mode",
    "needs_transcription": "transcribe",
    "needs_proofreading": "proofread",
    "needs_translation": "translate",
    "needs_segmentation": "segment",
}
ACTIVE_RENDITION_STATES = {
    "discovering",
    "probing",
    "downloading",
    "merging",
    "validating",
}
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")


def load_skill_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load workflow module: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SKILLS_ROOT = Path(__file__).resolve().parents[2]
WATCH_SCRIPTS = SKILLS_ROOT / "watch-video" / "scripts"
JOB_STATE = load_skill_module("insu_monitor_job_state", WATCH_SCRIPTS / "job_state.py")
MEDIA_CATALOG = load_skill_module(
    "insu_monitor_media_catalog", WATCH_SCRIPTS / "media_catalog.py"
)


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_stale(value: object, *, stale_after_seconds: int, now: datetime) -> bool:
    timestamp = parse_timestamp(value)
    if timestamp is None:
        return True
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return (now - timestamp.astimezone(timezone.utc)).total_seconds() > stale_after_seconds


def process_is_alive(pid: object) -> bool:
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def resolve_job_dir(project_root: Path, workspace: Path, video_id: str) -> Path:
    if not project_root.is_absolute() or not workspace.is_absolute():
        raise ValueError("project root and workspace must be absolute paths")
    project = project_root.resolve(strict=True)
    selected_workspace = workspace.resolve(strict=True)
    if project_root.is_symlink() or workspace.is_symlink():
        raise ValueError("project root and workspace cannot be symbolic links")
    try:
        selected_workspace.relative_to(project)
    except ValueError as error:
        raise ValueError("workspace must stay inside the selected project") from error
    validated_id = JOB_STATE.validate_video_id(video_id)
    job_dir = selected_workspace / "jobs" / validated_id
    if not job_dir.is_dir() or job_dir.is_symlink():
        raise ValueError("selected INSU Player job is unavailable")
    resolved_job = job_dir.resolve(strict=True)
    expected_job = (selected_workspace / "jobs" / validated_id).resolve(strict=True)
    if resolved_job != expected_job or resolved_job.name != validated_id:
        raise ValueError("job directory does not match the selected video ID")
    return resolved_job


def job_snapshot(
    job_dir: Path,
    *,
    stale_after_seconds: int,
    now: datetime,
) -> dict[str, Any]:
    status = JOB_STATE.load_status(job_dir)
    state = status["state"]
    process = status.get("process") if isinstance(status.get("process"), dict) else {}
    alive = process_is_alive(process.get("pid"))
    stale = state in ACTIVE_JOB_STATES and is_stale(
        status.get("updatedAt"), stale_after_seconds=stale_after_seconds, now=now
    )

    if state in ACTIVE_JOB_STATES:
        if alive and not stale:
            classification, next_action = "monitor", "wait"
        else:
            classification = "diagnose"
            next_action = "inspect-stale-process" if alive else "inspect-missing-process"
    elif state in CONTINUABLE_JOB_STATES:
        classification = "continue-workflow"
        next_action = CONTINUABLE_NEXT_ACTIONS[state]
    elif state == "ready":
        classification, next_action = "complete", "verify-and-stop"
    elif state == "queued":
        classification, next_action = "needs-user", "job-not-started"
    else:
        classification, next_action = "diagnose", f"inspect-{state}"

    return {
        "schemaVersion": status["schemaVersion"],
        "videoId": status["videoId"],
        "operation": "job",
        "state": state,
        "stage": status["stage"],
        "progress": float(status["progress"]),
        "processAlive": alive,
        "stale": stale,
        "updatedAt": status.get("updatedAt"),
        "errorPresent": bool(status.get("lastError")),
        "classification": classification,
        "nextAction": next_action,
    }


def rendition_snapshot(
    job_dir: Path,
    video_id: str,
    *,
    run_id: str | None,
    stale_after_seconds: int,
    now: datetime,
) -> dict[str, Any]:
    if run_id is not None and not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("invalid media run ID")
    catalog = MEDIA_CATALOG.load_catalog(job_dir, video_id)
    if catalog.get("schemaVersion") != MEDIA_CATALOG.SCHEMA_VERSION:
        raise ValueError(
            f"media catalog must use schemaVersion {MEDIA_CATALOG.SCHEMA_VERSION}"
        )
    operation = catalog.get("operation")
    if not isinstance(operation, dict):
        return {
            "schemaVersion": catalog["schemaVersion"],
            "videoId": video_id,
            "operation": "rendition",
            "state": "missing",
            "stage": "missing",
            "progress": 0.0,
            "processAlive": False,
            "stale": False,
            "updatedAt": None,
            "errorPresent": False,
            "classification": "needs-user",
            "nextAction": "operation-not-found",
        }
    if run_id is not None and operation.get("id") != run_id:
        return {
            "schemaVersion": catalog["schemaVersion"],
            "videoId": video_id,
            "operation": "rendition",
            "runId": operation.get("id"),
            "state": str(operation.get("state")),
            "stage": str(operation.get("stage")),
            "progress": float(operation.get("progress") or 0.0),
            "processAlive": False,
            "stale": False,
            "updatedAt": operation.get("updatedAt"),
            "errorPresent": bool(operation.get("error")),
            "classification": "needs-user",
            "nextAction": "run-id-mismatch",
        }

    state = operation["state"]
    alive = process_is_alive(operation.get("pid"))
    stale = state in ACTIVE_RENDITION_STATES and is_stale(
        operation.get("updatedAt"), stale_after_seconds=stale_after_seconds, now=now
    )
    if state in ACTIVE_RENDITION_STATES:
        if alive and not stale:
            classification, next_action = "monitor", "wait"
        else:
            classification = "diagnose"
            next_action = "inspect-stale-process" if alive else "inspect-missing-process"
    elif state == "ready":
        classification, next_action = "complete", "verify-rendition-and-stop"
    else:
        classification, next_action = "diagnose", f"inspect-{state}"

    return {
        "schemaVersion": catalog["schemaVersion"],
        "videoId": video_id,
        "operation": "rendition",
        "runId": operation.get("id"),
        "requestedHeight": operation.get("requestedHeight"),
        "state": state,
        "stage": operation.get("stage"),
        "progress": float(operation.get("progress") or 0.0),
        "processAlive": alive,
        "stale": stale,
        "updatedAt": operation.get("updatedAt"),
        "errorPresent": bool(operation.get("error")),
        "classification": classification,
        "nextAction": next_action,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--operation", choices=("job", "rendition"), default="job")
    parser.add_argument("--run-id")
    parser.add_argument("--stale-after-seconds", type=int, default=900)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.stale_after_seconds <= 0:
        raise ValueError("stale threshold must be positive")
    job_dir = resolve_job_dir(args.project_root, args.workspace, args.video_id)
    now = datetime.now(timezone.utc)
    if args.operation == "rendition":
        result = rendition_snapshot(
            job_dir,
            args.video_id,
            run_id=args.run_id,
            stale_after_seconds=args.stale_after_seconds,
            now=now,
        )
    else:
        if args.run_id is not None:
            raise ValueError("--run-id is only valid for rendition operations")
        result = job_snapshot(
            job_dir,
            stale_after_seconds=args.stale_after_seconds,
            now=now,
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
