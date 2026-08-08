#!/usr/bin/env python3
"""Agent-managed, browser-read-only prompt library for INSU Player."""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path


PROMPT_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MAX_PROMPTS = 100
FIELD_LIMITS = {"title": 80, "scenario": 240, "prompt": 6000}


def prompt_library_path(workspace: Path) -> Path:
    return workspace.resolve() / "prompts.json"


def _clean_text(value: object, field: str, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = value.strip()
    if required and not cleaned:
        raise ValueError(f"{field} cannot be empty")
    if len(cleaned) > FIELD_LIMITS[field]:
        raise ValueError(f"{field} exceeds {FIELD_LIMITS[field]} characters")
    return cleaned


def normalize_prompt(item: object) -> dict[str, str]:
    if not isinstance(item, dict):
        raise ValueError("each prompt must be an object")
    prompt_id = item.get("id")
    if not isinstance(prompt_id, str) or not PROMPT_ID_PATTERN.fullmatch(prompt_id):
        raise ValueError("prompt id must use lowercase letters, numbers, hyphens, or underscores")
    updated_at = item.get("updatedAt")
    if not isinstance(updated_at, str) or not updated_at.strip():
        updated_at = datetime.now(timezone.utc).isoformat()
    return {
        "id": prompt_id,
        "title": _clean_text(item.get("title"), "title"),
        "scenario": _clean_text(item.get("scenario"), "scenario"),
        "prompt": _clean_text(item.get("prompt"), "prompt"),
        "updatedAt": updated_at,
    }


def load_prompt_library(workspace: Path) -> dict[str, object]:
    path = prompt_library_path(workspace)
    if not path.is_file():
        return {"version": 1, "prompts": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("prompts"), list):
        raise ValueError("prompts.json must contain a prompts array")
    if len(payload["prompts"]) > MAX_PROMPTS:
        raise ValueError(f"prompts.json cannot contain more than {MAX_PROMPTS} prompts")
    prompts = [normalize_prompt(item) for item in payload["prompts"]]
    if len({item["id"] for item in prompts}) != len(prompts):
        raise ValueError("prompt ids must be unique")
    return {"version": 1, "prompts": prompts}


def save_prompt_library(workspace: Path, prompts: list[dict[str, str]]) -> dict[str, object]:
    workspace = workspace.resolve()
    if workspace in {Path("/"), Path.home().resolve()}:
        raise ValueError("choose a dedicated workspace, not the filesystem root or home directory")
    workspace.mkdir(parents=True, exist_ok=True)
    normalized = [normalize_prompt(item) for item in prompts]
    if len(normalized) > MAX_PROMPTS:
        raise ValueError(f"prompt library cannot contain more than {MAX_PROMPTS} prompts")
    if len({item["id"] for item in normalized}) != len(normalized):
        raise ValueError("prompt ids must be unique")
    payload: dict[str, object] = {"version": 1, "prompts": normalized}
    path = prompt_library_path(workspace)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, path)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="list prompts as JSON")
    list_parser.add_argument("workspace", type=Path)

    add_parser = subparsers.add_parser("add", help="add one prompt")
    add_parser.add_argument("workspace", type=Path)
    add_parser.add_argument("--id", required=True)
    add_parser.add_argument("--title", required=True)
    add_parser.add_argument("--scenario", required=True)
    add_parser.add_argument("--prompt", required=True)

    update_parser = subparsers.add_parser("update", help="update one prompt")
    update_parser.add_argument("workspace", type=Path)
    update_parser.add_argument("prompt_id")
    update_parser.add_argument("--title")
    update_parser.add_argument("--scenario")
    update_parser.add_argument("--prompt")

    remove_parser = subparsers.add_parser("remove", help="remove one prompt")
    remove_parser.add_argument("workspace", type=Path)
    remove_parser.add_argument("prompt_id")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    library = load_prompt_library(args.workspace)
    prompts = list(library["prompts"])

    if args.command == "list":
        print(json.dumps(library, ensure_ascii=False, indent=2))
        return 0

    if args.command == "add":
        if any(item["id"] == args.id for item in prompts):
            raise SystemExit(f"prompt already exists: {args.id}")
        prompts.append({
            "id": args.id,
            "title": args.title,
            "scenario": args.scenario,
            "prompt": args.prompt,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        })
    elif args.command == "update":
        if args.title is None and args.scenario is None and args.prompt is None:
            raise SystemExit("update requires at least one changed field")
        match = next((item for item in prompts if item["id"] == args.prompt_id), None)
        if match is None:
            raise SystemExit(f"prompt not found: {args.prompt_id}")
        for field in ("title", "scenario", "prompt"):
            value = getattr(args, field)
            if value is not None:
                match[field] = value
        match["updatedAt"] = datetime.now(timezone.utc).isoformat()
    elif args.command == "remove":
        retained = [item for item in prompts if item["id"] != args.prompt_id]
        if len(retained) == len(prompts):
            raise SystemExit(f"prompt not found: {args.prompt_id}")
        prompts = retained

    saved = save_prompt_library(args.workspace, prompts)
    print(json.dumps(saved, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
