#!/usr/bin/env python3
"""Maintain the durable multi-rendition media catalog for one INSU Player job."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
RENDITION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
RUN_STATES = {
    "discovering",
    "probing",
    "downloading",
    "merging",
    "validating",
    "ready",
    "failed",
    "interrupted",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and int(value) == value and value > 0:
        return int(value)
    return None


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def validate_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} must be a timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    return value


def validate_video_id(value: str) -> str:
    if not VIDEO_ID_PATTERN.fullmatch(value):
        raise ValueError("invalid video ID")
    return value


def validate_job_dir(job_dir: Path, video_id: str) -> Path:
    resolved = job_dir.resolve()
    if resolved.name != video_id or not resolved.is_dir() or resolved.is_symlink():
        raise ValueError("job directory does not match the selected video ID")
    return resolved


def catalog_path(job_dir: Path) -> Path:
    return job_dir / "media-work" / "catalog.json"


def validate_job_output_path(job_dir: Path, value: Path, label: str) -> Path:
    if value.is_symlink():
        raise ValueError(f"{label} must not be a symbolic link")
    resolved = value.resolve()
    if job_dir not in resolved.parents:
        raise ValueError(f"{label} must stay inside the selected job")
    return resolved


def empty_catalog(video_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": video_id,
        "revision": 0,
        "activeRenditionId": None,
        "availability": {"discoveredAt": None, "formats": []},
        "renditions": [],
        "operation": None,
    }


def validate_relative_rendition_path(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("rendition path must be a string")
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("rendition path must stay inside the job")
    if len(relative.parts) != 3 or relative.parts[:2] != ("source", "renditions"):
        raise ValueError("rendition path must be below source/renditions")
    return relative.as_posix()


def validate_catalog(payload: Any, video_id: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("media catalog must be an object")
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"media catalog must use schemaVersion {SCHEMA_VERSION}")
    if payload.get("videoId") != video_id:
        raise ValueError("media catalog videoId does not match its job")
    if positive_int(payload.get("revision")) is None and payload.get("revision") != 0:
        raise ValueError("media catalog revision must be a non-negative integer")
    renditions = payload.get("renditions")
    if not isinstance(renditions, list):
        raise ValueError("media catalog renditions must be an array")
    ids: set[str] = set()
    for rendition in renditions:
        if not isinstance(rendition, dict):
            raise ValueError("media rendition must be an object")
        rendition_id = rendition.get("id")
        if not isinstance(rendition_id, str) or not RENDITION_ID_PATTERN.fullmatch(rendition_id):
            raise ValueError("media rendition has an invalid ID")
        if rendition_id in ids:
            raise ValueError("media rendition IDs must be unique")
        ids.add(rendition_id)
        validate_relative_rendition_path(rendition.get("path"))
        for field in ("requestedHeight", "width", "height", "sizeBytes"):
            if positive_int(rendition.get(field)) is None:
                raise ValueError(f"media rendition {field} must be positive")
        checksum = rendition.get("checksum")
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("media rendition checksum is invalid")
        if rendition.get("container") != "mp4":
            raise ValueError("media rendition container must be mp4")
        for field in ("videoCodec", "audioCodec", "formatId", "selection"):
            if rendition.get(field) is not None and not isinstance(rendition.get(field), str):
                raise ValueError(f"media rendition {field} is invalid")
            if field not in rendition:
                raise ValueError(f"media rendition {field} is required")
        validate_timestamp(rendition.get("createdAt"), "media rendition createdAt")
    active = payload.get("activeRenditionId")
    if active is not None and active not in ids:
        raise ValueError("active rendition is not registered")
    availability = payload.get("availability")
    if (
        not isinstance(availability, dict)
        or set(availability) != {"discoveredAt", "formats"}
        or not isinstance(availability.get("formats"), list)
    ):
        raise ValueError("media catalog availability is invalid")
    discovered_at = availability.get("discoveredAt")
    if discovered_at is not None:
        validate_timestamp(discovered_at, "media catalog discoveredAt")
    for source_format in availability["formats"]:
        if not isinstance(source_format, dict) or set(source_format) != {
            "height",
            "width",
            "fps",
            "container",
            "videoCodec",
            "estimatedBytes",
        }:
            raise ValueError("media source format fields are invalid")
        if positive_int(source_format.get("height")) is None or source_format.get("container") != "mp4":
            raise ValueError("media source format is invalid")
        for field in ("width", "estimatedBytes"):
            value = source_format.get(field)
            if value is not None and positive_int(value) is None:
                raise ValueError(f"media source format {field} is invalid")
        fps = source_format.get("fps")
        if fps is not None and (finite_number(fps) is None or float(fps) <= 0):
            raise ValueError("media source format fps is invalid")
        if source_format.get("videoCodec") is not None and not isinstance(source_format.get("videoCodec"), str):
            raise ValueError("media source format videoCodec is invalid")
    operation = payload.get("operation")
    if operation is not None:
        if (
            not isinstance(operation, dict)
            or set(operation) != {
                "id",
                "requestedHeight",
                "state",
                "stage",
                "progress",
                "message",
                "error",
                "pid",
                "startedAt",
                "updatedAt",
                "completedAt",
            }
            or operation.get("state") not in RUN_STATES
        ):
            raise ValueError("media catalog operation is invalid")
        if not isinstance(operation.get("id"), str) or not RUN_ID_PATTERN.fullmatch(operation["id"]):
            raise ValueError("media catalog operation ID is invalid")
        if operation.get("requestedHeight") is not None and positive_int(operation.get("requestedHeight")) is None:
            raise ValueError("media catalog operation requestedHeight is invalid")
        progress = finite_number(operation.get("progress"))
        if progress is None or not 0 <= progress <= 100:
            raise ValueError("media catalog operation progress is invalid")
        if not isinstance(operation.get("stage"), str) or not isinstance(operation.get("message"), str):
            raise ValueError("media catalog operation text fields are invalid")
        if operation.get("error") is not None and not isinstance(operation.get("error"), str):
            raise ValueError("media catalog operation error is invalid")
        if operation.get("pid") is not None and positive_int(operation.get("pid")) is None:
            raise ValueError("media catalog operation pid is invalid")
        validate_timestamp(operation.get("startedAt"), "media catalog operation startedAt")
        validate_timestamp(operation.get("updatedAt"), "media catalog operation updatedAt")
        if operation.get("completedAt") is not None:
            validate_timestamp(operation.get("completedAt"), "media catalog operation completedAt")
    elif "operation" not in payload:
        raise ValueError("media catalog operation is required")
    return payload


def load_catalog(job_dir: Path, video_id: str) -> dict[str, Any]:
    path = catalog_path(job_dir)
    if not path.is_file() or path.is_symlink():
        return empty_catalog(video_id)
    return validate_catalog(json.loads(path.read_text(encoding="utf-8")), video_id)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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


def write_catalog(job_dir: Path, payload: dict[str, Any]) -> None:
    revision = payload.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("media catalog revision must be a non-negative integer")
    payload["revision"] = revision + 1
    validate_catalog(payload, str(payload["videoId"]))
    atomic_write_json(catalog_path(job_dir), payload)


def file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def codec_slug(value: Any) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "-", str(value or "video")).strip("-").lower()
    return normalized[:24] or "video"


def source_formats(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    raw_formats = metadata.get("formats")
    if not isinstance(raw_formats, list):
        raise ValueError("yt-dlp metadata does not include formats")
    selected: dict[int, dict[str, Any]] = {}
    for raw in raw_formats:
        if not isinstance(raw, dict) or raw.get("ext") != "mp4":
            continue
        if raw.get("vcodec") in {None, "none"}:
            continue
        height = positive_int(raw.get("height"))
        if height is None:
            continue
        candidate = {
            "height": height,
            "width": positive_int(raw.get("width")),
            "fps": finite_number(raw.get("fps")),
            "container": "mp4",
            "videoCodec": str(raw.get("vcodec")) if raw.get("vcodec") else None,
            "estimatedBytes": positive_int(raw.get("filesize"))
            or positive_int(raw.get("filesize_approx")),
        }
        current = selected.get(height)
        candidate_score = (
            str(candidate["videoCodec"] or "").startswith("avc1"),
            candidate["estimatedBytes"] is not None,
            candidate["width"] or 0,
        )
        current_score = (
            str((current or {}).get("videoCodec") or "").startswith("avc1"),
            (current or {}).get("estimatedBytes") is not None,
            (current or {}).get("width") or 0,
        )
        if current is None or candidate_score > current_score:
            selected[height] = candidate
    return [selected[height] for height in sorted(selected, reverse=True)]


def discovery_snapshot(video_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": video_id,
        "availability": {
            "discoveredAt": utc_now(),
            "formats": source_formats(metadata),
        },
    }


def validate_discovery_snapshot(payload: Any, video_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != {"schemaVersion", "videoId", "availability"}
        or payload.get("schemaVersion") != SCHEMA_VERSION
        or payload.get("videoId") != video_id
    ):
        raise ValueError("media discovery snapshot does not match the selected job")
    probe = empty_catalog(video_id)
    probe["availability"] = payload["availability"]
    validate_catalog(probe, video_id)
    return payload


def command_discover(args: argparse.Namespace) -> int:
    video_id = validate_video_id(args.video_id)
    job_dir = validate_job_dir(args.job_dir, video_id)
    metadata = json.load(sys.stdin)
    if not isinstance(metadata, dict) or metadata.get("id") != video_id:
        raise ValueError("source metadata does not match the selected video")
    snapshot = discovery_snapshot(video_id, metadata)
    if args.output is not None:
        output = validate_job_output_path(job_dir, args.output, "discovery output")
        atomic_write_json(output, snapshot)
        print(json.dumps(snapshot, ensure_ascii=False, sort_keys=True))
        return 0
    catalog = load_catalog(job_dir, video_id)
    catalog["availability"] = snapshot["availability"]
    write_catalog(job_dir, catalog)
    print(json.dumps(catalog, ensure_ascii=False, sort_keys=True))
    return 0


def command_run_update(args: argparse.Namespace) -> int:
    video_id = validate_video_id(args.video_id)
    job_dir = validate_job_dir(args.job_dir, video_id)
    if not RUN_ID_PATTERN.fullmatch(args.run_id):
        raise ValueError("invalid media run ID")
    if args.state not in RUN_STATES:
        raise ValueError("invalid media run state")
    catalog = load_catalog(job_dir, video_id)
    previous = catalog.get("operation")
    started_at = (
        previous.get("startedAt")
        if isinstance(previous, dict) and previous.get("id") == args.run_id
        else utc_now()
    )
    now = utc_now()
    catalog["operation"] = {
        "id": args.run_id,
        "requestedHeight": args.requested_height,
        "state": args.state,
        "stage": args.stage,
        "progress": max(0.0, min(100.0, args.progress)),
        "message": args.message,
        "error": args.error,
        "pid": args.pid,
        "startedAt": started_at,
        "updatedAt": now,
        "completedAt": now if args.state in {"ready", "failed", "interrupted"} else None,
    }
    write_catalog(job_dir, catalog)
    return 0


def command_publish(args: argparse.Namespace) -> int:
    video_id = validate_video_id(args.video_id)
    job_dir = validate_job_dir(args.job_dir, video_id)
    source_file = args.source_file.resolve()
    if job_dir not in source_file.parents or not source_file.is_file() or source_file.is_symlink():
        raise ValueError("published media must be a regular file inside the selected job")
    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    selected = selection.get("selected") if isinstance(selection, dict) else None
    validation = selection.get("validation") if isinstance(selection, dict) else None
    if not isinstance(selected, dict) or not isinstance(validation, dict):
        raise ValueError("media selection is invalid")
    width = positive_int(selected.get("width"))
    height = positive_int(selected.get("height"))
    if (
        width is None
        or height is None
        or height != args.requested_height
        or selected.get("container") != "mp4"
    ):
        raise ValueError("published media resolution does not match the requested height")
    if validation.get("resolutionConfirmed") is not True:
        raise ValueError("published media resolution was not verified")
    checksum = file_checksum(source_file)
    rendition_id = f"{height}p-{codec_slug(selected.get('videoCodec') or selected.get('probedVideoCodec'))}-{checksum[:12]}"
    if not RENDITION_ID_PATTERN.fullmatch(rendition_id):
        raise ValueError("generated rendition ID is invalid")
    destination_directory = job_dir / "source" / "renditions"
    destination_directory.mkdir(parents=True, exist_ok=True)
    destination = destination_directory / f"{rendition_id}.mp4"
    catalog = load_catalog(job_dir, video_id)
    if args.discovery is not None:
        discovery_path = validate_job_output_path(
            job_dir, args.discovery, "discovery snapshot"
        )
        if not discovery_path.is_file():
            raise ValueError("media discovery snapshot is unavailable")
        snapshot = validate_discovery_snapshot(
            json.loads(discovery_path.read_text(encoding="utf-8")), video_id
        )
        catalog["availability"] = snapshot["availability"]
    existing_height = next(
        (item for item in catalog["renditions"] if item.get("height") == height), None
    )
    if existing_height and existing_height.get("id") != rendition_id:
        raise ValueError(f"a verified {height}p rendition already exists")
    if destination.exists():
        if destination.is_symlink() or file_checksum(destination) != checksum:
            raise ValueError("rendition destination already exists with different contents")
        if source_file != destination:
            source_file.unlink()
    elif source_file != destination:
        os.replace(source_file, destination)
    rendition = {
        "id": rendition_id,
        "requestedHeight": args.requested_height,
        "width": width,
        "height": height,
        "container": selected["container"],
        "videoCodec": selected.get("videoCodec") or selected.get("probedVideoCodec"),
        "audioCodec": selected.get("audioCodec") or selected.get("probedAudioCodec"),
        "formatId": selected.get("formatId"),
        "path": destination.relative_to(job_dir).as_posix(),
        "sizeBytes": destination.stat().st_size,
        "checksum": checksum,
        "createdAt": utc_now(),
        "selection": args.selection.resolve().relative_to(job_dir).as_posix()
        if job_dir in args.selection.resolve().parents
        else None,
    }
    catalog["renditions"] = [
        item for item in catalog["renditions"] if item.get("id") != rendition_id
    ] + [rendition]
    catalog["renditions"].sort(key=lambda item: int(item["height"]), reverse=True)
    if catalog.get("activeRenditionId") is None or args.activate:
        catalog["activeRenditionId"] = rendition_id
    if args.run_id and isinstance(catalog.get("operation"), dict):
        if catalog["operation"].get("id") == args.run_id:
            now = utc_now()
            catalog["operation"].update(
                {
                    "state": "ready",
                    "stage": "ready",
                    "progress": 100.0,
                    "message": f"{height}p 畫質已下載",
                    "error": None,
                    "pid": None,
                    "updatedAt": now,
                    "completedAt": now,
                }
            )
    write_catalog(job_dir, catalog)
    print(json.dumps(rendition, ensure_ascii=False, sort_keys=True))
    return 0


def active_rendition(catalog: dict[str, Any]) -> dict[str, Any]:
    active_id = catalog.get("activeRenditionId")
    rendition = next((item for item in catalog["renditions"] if item.get("id") == active_id), None)
    if not isinstance(rendition, dict):
        raise ValueError("media catalog has no active rendition")
    return rendition


def command_active_path(args: argparse.Namespace) -> int:
    video_id = validate_video_id(args.video_id)
    job_dir = validate_job_dir(args.job_dir, video_id)
    rendition = active_rendition(load_catalog(job_dir, video_id))
    candidate = job_dir / validate_relative_rendition_path(rendition.get("path"))
    if not candidate.is_file() or candidate.is_symlink():
        raise ValueError("active rendition file is unavailable")
    print(candidate)
    return 0


def command_activate(args: argparse.Namespace) -> int:
    video_id = validate_video_id(args.video_id)
    job_dir = validate_job_dir(args.job_dir, video_id)
    if not RENDITION_ID_PATTERN.fullmatch(args.rendition_id):
        raise ValueError("invalid rendition ID")
    catalog = load_catalog(job_dir, video_id)
    if not any(item.get("id") == args.rendition_id for item in catalog["renditions"]):
        raise ValueError("media rendition not found")
    catalog["activeRenditionId"] = args.rendition_id
    write_catalog(job_dir, catalog)
    print(json.dumps(catalog, ensure_ascii=False, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover")
    discover.add_argument("--job-dir", required=True, type=Path)
    discover.add_argument("--video-id", required=True)
    discover.add_argument("--output", type=Path)
    discover.set_defaults(handler=command_discover)

    run_update = subparsers.add_parser("run-update")
    run_update.add_argument("--job-dir", required=True, type=Path)
    run_update.add_argument("--video-id", required=True)
    run_update.add_argument("--run-id", required=True)
    run_update.add_argument("--requested-height", type=int)
    run_update.add_argument("--state", required=True)
    run_update.add_argument("--stage", required=True)
    run_update.add_argument("--progress", type=float, default=0.0)
    run_update.add_argument("--message", required=True)
    run_update.add_argument("--error")
    run_update.add_argument("--pid", type=int)
    run_update.set_defaults(handler=command_run_update)

    publish = subparsers.add_parser("publish")
    publish.add_argument("--job-dir", required=True, type=Path)
    publish.add_argument("--video-id", required=True)
    publish.add_argument("--source-file", required=True, type=Path)
    publish.add_argument("--selection", required=True, type=Path)
    publish.add_argument("--discovery", type=Path)
    publish.add_argument("--requested-height", required=True, type=int)
    publish.add_argument("--run-id")
    publish.add_argument("--activate", action="store_true")
    publish.set_defaults(handler=command_publish)

    active_path = subparsers.add_parser("active-path")
    active_path.add_argument("--job-dir", required=True, type=Path)
    active_path.add_argument("--video-id", required=True)
    active_path.set_defaults(handler=command_active_path)

    activate = subparsers.add_parser("activate")
    activate.add_argument("--job-dir", required=True, type=Path)
    activate.add_argument("--video-id", required=True)
    activate.add_argument("--rendition-id", required=True)
    activate.set_defaults(handler=command_activate)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.handler(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"error: {error}") from error
