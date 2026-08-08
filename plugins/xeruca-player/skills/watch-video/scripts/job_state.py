#!/usr/bin/env python3
"""Durable, atomic job-state storage for the local YouTube library."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
STATES = {
    "queued",
    "checking",
    "downloading",
    "downloaded",
    "needs_transcription",
    "transcribing",
    "needs_translation",
    "translating",
    "preparing_player",
    "ready",
    "interrupted",
    "failed",
}
ACTIVE_STATES = {"checking", "downloading", "transcribing", "translating", "preparing_player"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_PATTERN.fullmatch(video_id):
        raise ValueError(f"invalid video ID: {video_id!r}")
    return video_id


def validate_language(language: str) -> str:
    if not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError(f"invalid language code: {language!r}")
    return language


def state_path(job_dir: Path) -> Path:
    return job_dir / "status.json"


def default_status(job_dir: Path, video_id: str | None = None) -> dict[str, Any]:
    resolved_id = validate_video_id(video_id or job_dir.name)
    now = utc_now()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": resolved_id,
        "title": resolved_id,
        "sourceUrl": "",
        "state": "queued",
        "stage": "queued",
        "progress": 0.0,
        "message": "等待處理",
        "assets": {},
        "subtitleTracks": {},
        "transcription": None,
        "process": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
        "completedAt": None,
        "history": [
            {
                "at": now,
                "state": "queued",
                "stage": "queued",
                "message": "建立任務",
            }
        ],
    }


def load_status(job_dir: Path, *, create_default: bool = False) -> dict[str, Any]:
    path = state_path(job_dir)
    if not path.exists():
        if create_default:
            return default_status(job_dir)
        raise FileNotFoundError(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"job state is not a JSON object: {path}")
    validate_video_id(str(data.get("videoId", job_dir.name)))
    return data


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_name = handle.name
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def relative_job_path(job_dir: Path, candidate: Path) -> str:
    job_root = job_dir.resolve()
    target = candidate.resolve()
    try:
        return target.relative_to(job_root).as_posix()
    except ValueError as error:
        raise ValueError(f"asset must stay inside the job directory: {candidate}") from error


def save_status(job_dir: Path, status: dict[str, Any]) -> dict[str, Any]:
    status["schemaVersion"] = SCHEMA_VERSION
    status["updatedAt"] = utc_now()
    history = status.setdefault("history", [])
    if isinstance(history, list) and len(history) > 120:
        status["history"] = history[-120:]
    atomic_write_json(state_path(job_dir), status)
    return status


def initialize_job(job_dir: Path, video_id: str, source_url: str, title: str) -> dict[str, Any]:
    validate_video_id(video_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        status = load_status(job_dir)
    except FileNotFoundError:
        status = default_status(job_dir, video_id)
    status.update(
        {
            "videoId": video_id,
            "sourceUrl": source_url,
            "title": title or status.get("title") or video_id,
        }
    )
    return save_status(job_dir, status)


def patch_status(
    job_dir: Path,
    patch: dict[str, Any],
    *,
    record_history: bool = False,
) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    old_state = status.get("state")
    old_stage = status.get("stage")
    old_message = status.get("message")

    if "state" in patch:
        new_state = str(patch["state"])
        if new_state not in STATES:
            raise ValueError(f"unsupported state: {new_state}")
    if "progress" in patch and patch["progress"] is not None:
        patch["progress"] = max(0.0, min(100.0, float(patch["progress"])))

    status.update(patch)
    state = status.get("state")
    if state == "ready":
        status["progress"] = 100.0
        status["completedAt"] = status.get("completedAt") or utc_now()
        status["lastError"] = None
        status["process"] = None
    elif state == "failed":
        status["process"] = None
    elif old_state == "ready":
        status["completedAt"] = None

    changed = (
        old_state != status.get("state")
        or old_stage != status.get("stage")
        or old_message != status.get("message")
    )
    if record_history or changed:
        status.setdefault("history", []).append(
            {
                "at": utc_now(),
                "state": status.get("state"),
                "stage": status.get("stage"),
                "message": status.get("message"),
            }
        )
    return save_status(job_dir, status)


def set_asset(job_dir: Path, name: str, path: Path) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    assets = status.setdefault("assets", {})
    assets[name] = {
        "path": relative_job_path(job_dir, path),
        "bytes": path.stat().st_size if path.exists() and path.is_file() else None,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def remove_asset(job_dir: Path, name: str) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    assets = status.setdefault("assets", {})
    assets.pop(name, None)
    return save_status(job_dir, status)


def set_subtitle(
    job_dir: Path,
    language: str,
    track_state: str,
    path: Path | None,
    source: str,
    label: str | None,
) -> dict[str, Any]:
    validate_language(language)
    status = load_status(job_dir, create_default=True)
    tracks = status.setdefault("subtitleTracks", {})
    track: dict[str, Any] = {
        "state": track_state,
        "source": source,
        "label": label or language,
        "updatedAt": utc_now(),
    }
    if path is not None:
        track["path"] = relative_job_path(job_dir, path)
        track["bytes"] = path.stat().st_size if path.exists() else None
    tracks[language] = track
    return save_status(job_dir, status)


def set_transcription(job_dir: Path, provider: str, model: str) -> dict[str, Any]:
    if provider not in {"local", "openai"}:
        raise ValueError(f"unsupported transcription provider: {provider}")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
        raise ValueError(f"invalid transcription model: {model}")
    status = load_status(job_dir, create_default=True)
    status["transcription"] = {
        "provider": provider,
        "model": model,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="create or refresh a job record")
    init_parser.add_argument("--job-dir", required=True, type=Path)
    init_parser.add_argument("--video-id", required=True)
    init_parser.add_argument("--source-url", required=True)
    init_parser.add_argument("--title", default="")

    update_parser = subparsers.add_parser("update", help="update state and progress")
    update_parser.add_argument("--job-dir", required=True, type=Path)
    update_parser.add_argument("--state", choices=sorted(STATES))
    update_parser.add_argument("--stage")
    update_parser.add_argument("--message")
    update_parser.add_argument("--progress", type=float)
    update_parser.add_argument("--error")
    update_parser.add_argument("--title")
    update_parser.add_argument("--clear-error", action="store_true")
    update_parser.add_argument("--record-history", action="store_true")

    asset_parser = subparsers.add_parser("asset", help="record a generated asset")
    asset_parser.add_argument("--job-dir", required=True, type=Path)
    asset_parser.add_argument("--name", required=True)
    asset_parser.add_argument("--path", type=Path)
    asset_parser.add_argument("--remove", action="store_true")

    subtitle_parser = subparsers.add_parser("subtitle", help="record a subtitle track")
    subtitle_parser.add_argument("--job-dir", required=True, type=Path)
    subtitle_parser.add_argument("--language", required=True)
    subtitle_parser.add_argument("--state", default="ready")
    subtitle_parser.add_argument("--path", type=Path)
    subtitle_parser.add_argument("--source", default="unknown")
    subtitle_parser.add_argument("--label")

    transcription_parser = subparsers.add_parser("transcription", help="record transcription provider metadata")
    transcription_parser.add_argument("--job-dir", required=True, type=Path)
    transcription_parser.add_argument("--provider", required=True, choices=("local", "openai"))
    transcription_parser.add_argument("--model", required=True)

    show_parser = subparsers.add_parser("show", help="print a job record")
    show_parser.add_argument("--job-dir", required=True, type=Path)
    show_parser.add_argument("--field")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "init":
        status = initialize_job(args.job_dir, args.video_id, args.source_url, args.title)
    elif args.command == "update":
        patch: dict[str, Any] = {}
        for key in ("state", "stage", "message", "progress", "title"):
            value = getattr(args, key)
            if value is not None:
                patch[key] = value
        if args.error is not None:
            patch["lastError"] = args.error
        if args.clear_error:
            patch["lastError"] = None
        status = patch_status(args.job_dir, patch, record_history=args.record_history)
    elif args.command == "asset":
        if args.remove:
            status = remove_asset(args.job_dir, args.name)
        elif args.path is not None:
            status = set_asset(args.job_dir, args.name, args.path)
        else:
            raise ValueError("asset requires --path or --remove")
    elif args.command == "subtitle":
        status = set_subtitle(
            args.job_dir,
            args.language,
            args.state,
            args.path,
            args.source,
            args.label,
        )
    elif args.command == "transcription":
        status = set_transcription(args.job_dir, args.provider, args.model)
    elif args.command == "show":
        status = load_status(args.job_dir)
        if args.field:
            value: Any = status
            for part in args.field.split("."):
                if not isinstance(value, dict) or part not in value:
                    raise KeyError(args.field)
                value = value[part]
            if isinstance(value, (dict, list)):
                print(json.dumps(value, ensure_ascii=False))
            elif value is not None:
                print(value)
            return 0
    else:
        raise AssertionError(args.command)

    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
