#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]+$")
ARTIFACT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
LANGUAGE = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_BYTES = 250_000


def safe_text(value: str, field: str, maximum: int) -> str:
    value = value.strip()
    if not value or len(value) > maximum or CONTROL.search(value):
        raise ValueError(f"{field} is invalid")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("text",), required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--source-subtitle-artifact-id", required=True)
    parser.add_argument("--content-file", type=Path, required=True)
    args = parser.parse_args()

    if not VIDEO_ID.fullmatch(args.video_id):
        raise ValueError("video ID is invalid")
    if not ARTIFACT_ID.fullmatch(args.source_subtitle_artifact_id):
        raise ValueError("subtitle artifact ID is invalid")
    language = safe_text(args.language, "language", 40)
    if not LANGUAGE.fullmatch(language):
        raise ValueError("language is invalid")
    title = safe_text(args.title, "title", 160)
    if not args.content_file.is_file() or args.content_file.is_symlink():
        raise ValueError("content file is unavailable")
    content = safe_text(args.content_file.read_text(encoding="utf-8"), "content", MAX_BYTES)
    if len(content.encode("utf-8")) > MAX_BYTES:
        raise ValueError("content is too large")
    print(json.dumps({
        "kind": "text",
        "languageCode": language,
        "title": title,
        "content": content,
        "sourceSubtitleArtifactId": args.source_subtitle_artifact_id,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
