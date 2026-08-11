#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
LANGUAGE = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
MAX_BYTES = 250_000


def safe_text(value: str, field: str, maximum: int) -> str:
    value = value.strip()
    if not value or len(value) > maximum or CONTROL.search(value):
        raise ValueError(f"{field} is invalid")
    return value


def validate_tree(content: str, video_id: str) -> tuple[int, int]:
    if re.search(r"<[^>]+>", content) or "```" in content or re.search(r"!\[[^\]]*\]\(", content):
        raise ValueError("unsafe mind map content")
    nodes = [line.rstrip() for line in content.splitlines() if line.strip()]
    if not 1 <= len(nodes) <= 120:
        raise ValueError("mind map must contain between 1 and 120 nodes")
    roots = [line for line in nodes if re.fullmatch(r"#\s+.+", line)]
    if len(roots) != 1 or nodes[0] != roots[0]:
        raise ValueError("mind map requires exactly one first root heading")
    maximum_depth = 1
    for line in nodes:
        heading = re.fullmatch(r"(#{1,4})\s+(.+)", line)
        item = re.fullmatch(r"(\s*)-\s+(.+)", line)
        if not heading and not item:
            raise ValueError("mind map only accepts headings and list items")
        label = (heading.group(2) if heading else item.group(2)).strip()
        if not label or len(label) > 160:
            raise ValueError("mind map node is invalid")
        if heading:
            depth = len(heading.group(1))
        else:
            spaces = len(item.group(1))
            if spaces % 2:
                raise ValueError("list indentation must use two spaces")
            depth = spaces // 2 + 2
        if depth > 4:
            raise ValueError("mind map exceeds four levels")
        maximum_depth = max(maximum_depth, depth)
        prefix = f"/player/{video_id}?time="
        for target in LINK.findall(label):
            seconds = target[len(prefix):] if target.startswith(prefix) else ""
            if not re.fullmatch(r"\d+(?:\.\d{1,3})?", seconds):
                raise ValueError("mind map link is not a same-video timestamp")
    return len(nodes), maximum_depth


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("mindmap",), required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--source-summary-artifact-id", required=True)
    parser.add_argument("--content-file", type=Path, required=True)
    args = parser.parse_args()
    if not SAFE_ID.fullmatch(args.video_id) or not SAFE_ID.fullmatch(args.source_summary_artifact_id):
        raise ValueError("resource ID is invalid")
    language = safe_text(args.language, "language", 40)
    if not LANGUAGE.fullmatch(language):
        raise ValueError("language is invalid")
    title = safe_text(args.title, "title", 160)
    if not args.content_file.is_file() or args.content_file.is_symlink():
        raise ValueError("content file is unavailable")
    content = safe_text(args.content_file.read_text(encoding="utf-8"), "content", MAX_BYTES)
    if len(content.encode("utf-8")) > MAX_BYTES:
        raise ValueError("content is too large")
    validate_tree(content, args.video_id)
    print(json.dumps({
        "kind": "mindmap",
        "languageCode": language,
        "title": title,
        "content": content,
        "sourceSummaryArtifactId": args.source_summary_artifact_id,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
