#!/usr/bin/env python3
"""Plan, record, and validate INSU Player media quality decisions."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RESOLUTION_PATTERN = re.compile(r"(?<!\d)(\d{2,5})x(\d{2,5})(?!\d)")
VIDEO_CODEC_PATTERN = re.compile(r"Video:\s*([^,\s]+)")
AUDIO_CODEC_PATTERN = re.compile(r"Audio:\s*([^,\s]+)")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and int(value) == value and value > 0:
        return int(value)
    return None


def command_plan(args: argparse.Namespace) -> int:
    payload = json.load(sys.stdin)
    formats = payload.get("formats")
    if not isinstance(formats, list):
        raise ValueError("yt-dlp metadata does not include a formats array")

    heights: set[int] = set()
    for candidate in formats:
        if not isinstance(candidate, dict):
            continue
        if candidate.get("vcodec") in {None, "none"}:
            continue
        if candidate.get("ext") != "mp4":
            continue
        height = positive_int(candidate.get("height"))
        if height is not None and height <= args.preferred_max_height:
            heights.add(height)

    if not heights:
        raise ValueError(
            f"no browser-oriented MP4 format at or below {args.preferred_max_height}p"
        )
    for height in sorted(heights, reverse=True):
        print(height)
    return 0


def command_record_attempt(args: argparse.Namespace) -> int:
    payload = {
        "at": utc_now(),
        "height": args.height,
        "retry": args.retry,
        "probeResult": args.probe_result,
        "httpStatuses": [
            int(value)
            for value in args.http_statuses.split(",")
            if value.strip().isdigit()
        ],
        "downloadResult": args.download_result,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    return 0


def read_attempts(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    attempts: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw_line.strip():
            continue
        candidate = json.loads(raw_line)
        if not isinstance(candidate, dict):
            raise ValueError(f"attempt log line {line_number} is not an object")
        attempts.append(candidate)
    return attempts


def read_media_info(path: Path) -> tuple[int, int, str, str | None]:
    if not path.is_file():
        raise ValueError(f"media info is missing: {path}")
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    audio_codec = next(
        (
            match.group(1)
            for line in lines
            if (match := AUDIO_CODEC_PATTERN.search(line))
        ),
        None,
    )
    for line in lines:
        if "Video:" not in line:
            continue
        resolution = RESOLUTION_PATTERN.search(line)
        codec = VIDEO_CODEC_PATTERN.search(line)
        if resolution:
            return (
                int(resolution.group(1)),
                int(resolution.group(2)),
                codec.group(1) if codec else "unknown",
                audio_codec,
            )
    raise ValueError("media info does not contain a video resolution")


def read_selection(path: Path | None) -> dict[str, Any]:
    if path is None or not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("yt-dlp selection metadata is not an object")
    return {
        "formatId": payload.get("format_id"),
        "container": payload.get("ext"),
        "videoCodec": payload.get("vcodec"),
        "audioCodec": payload.get("acodec"),
    }


def command_finalize(args: argparse.Namespace) -> int:
    width, height, probed_codec, probed_audio_codec = read_media_info(args.media_info)
    attempts = read_attempts(args.attempt_log)
    selection = read_selection(args.selection_info)

    if not args.existing:
        if args.selected_height is None:
            raise ValueError("--selected-height is required for a new download")
        if height != args.selected_height:
            raise ValueError(
                f"downloaded video is {height}p but the selected format was {args.selected_height}p"
            )
        if height < args.minimum_height and not args.allow_low_quality:
            raise ValueError(
                f"downloaded video is below the {args.minimum_height}p minimum without explicit approval"
            )

    higher_failures = [
        attempt
        for attempt in attempts
        if positive_int(attempt.get("height")) is not None
        and int(attempt["height"]) > height
        and attempt.get("downloadResult") != "success"
    ]
    fallback_reason = "higher-quality-attempts-failed" if higher_failures else None
    policy_state = "preexisting" if args.existing else "validated"

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "updatedAt": utc_now(),
        "policy": {
            "preferredMaximumHeight": args.preferred_max_height,
            "minimumHeight": args.minimum_height,
            "belowMinimumAllowed": args.allow_low_quality,
            "state": policy_state,
        },
        "bestAvailableHeight": args.best_available_height,
        "selected": {
            **selection,
            "width": width,
            "height": height,
            "probedVideoCodec": probed_codec,
            "probedAudioCodec": probed_audio_codec,
        },
        "fallbackReason": fallback_reason,
        "attempts": attempts,
        "validation": {
            "resolutionConfirmed": True,
            "selectedHeightMatches": args.existing or height == args.selected_height,
            "meetsMinimumHeight": height >= args.minimum_height,
        },
    }
    atomic_write_json(args.output, payload)
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan", help="list available MP4 heights in descending order")
    plan_parser.add_argument("--preferred-max-height", type=int, default=1080)
    plan_parser.set_defaults(handler=command_plan)

    attempt_parser = subparsers.add_parser("record-attempt", help="append one probe/download attempt")
    attempt_parser.add_argument("--output", required=True, type=Path)
    attempt_parser.add_argument("--height", required=True, type=int)
    attempt_parser.add_argument("--retry", required=True, type=int)
    attempt_parser.add_argument(
        "--probe-result", required=True, choices=("ok", "unavailable", "http-failed")
    )
    attempt_parser.add_argument("--http-statuses", default="")
    attempt_parser.add_argument(
        "--download-result", required=True, choices=("not-run", "failed", "success")
    )
    attempt_parser.set_defaults(handler=command_record_attempt)

    finalize_parser = subparsers.add_parser("finalize", help="validate and record the selected media")
    finalize_parser.add_argument("--output", required=True, type=Path)
    finalize_parser.add_argument("--media-info", required=True, type=Path)
    finalize_parser.add_argument("--attempt-log", required=True, type=Path)
    finalize_parser.add_argument("--selection-info", type=Path)
    finalize_parser.add_argument("--preferred-max-height", required=True, type=int)
    finalize_parser.add_argument("--minimum-height", required=True, type=int)
    finalize_parser.add_argument("--best-available-height", type=int)
    finalize_parser.add_argument("--selected-height", type=int)
    finalize_parser.add_argument("--allow-low-quality", action="store_true")
    finalize_parser.add_argument("--existing", action="store_true")
    finalize_parser.set_defaults(handler=command_finalize)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if getattr(args, "preferred_max_height", 1) <= 0:
        raise ValueError("preferred maximum height must be positive")
    if getattr(args, "minimum_height", 1) <= 0:
        raise ValueError("minimum height must be positive")
    return args.handler(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"error: {error}") from error
