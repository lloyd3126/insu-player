#!/usr/bin/env python3
"""Validate canonical OpenAI Whisper model files and publish strict manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import whisper


CANONICAL_MODELS = (
    "tiny", "tiny.en", "base", "base.en", "small", "small.en",
    "medium", "medium.en", "large-v1", "large-v2", "large-v3",
    "large-v3-turbo",
)
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")


def expected_checksum(model_id: str) -> str:
    if model_id not in CANONICAL_MODELS:
        raise ValueError(f"unsupported canonical model: {model_id}")
    url = whisper._MODELS.get(model_id)
    if not isinstance(url, str):
        raise ValueError(f"installed Whisper does not publish model: {model_id}")
    parts = [part for part in urlparse(url).path.split("/") if part]
    if len(parts) < 2 or not CHECKSUM.fullmatch(parts[-2]):
        raise ValueError(f"Whisper model URL has no trusted checksum: {model_id}")
    return parts[-2]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def validate(models_dir: Path, model_id: str) -> dict[str, object]:
    model_path = models_dir / f"{model_id}.pt"
    if model_path.is_symlink() or not model_path.is_file():
        raise ValueError(f"model file is unavailable: {model_id}")
    expected = expected_checksum(model_id)
    actual = digest(model_path)
    if actual != expected:
        raise ValueError(f"model checksum mismatch: {model_id}")
    manifest = {
        "schemaVersion": 1,
        "modelId": model_id,
        "checksum": actual,
        "sizeBytes": model_path.stat().st_size,
        "validatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    output = models_dir / f"{model_id}.json"
    temporary = models_dir / f".{model_id}.json.tmp"
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    os.replace(temporary, output)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--model-id", choices=CANONICAL_MODELS)
    group.add_argument("--all", action="store_true")
    args = parser.parse_args()
    models_dir = args.models_dir.resolve()
    if models_dir.is_symlink() or not models_dir.is_dir():
        raise ValueError("models directory is unavailable")
    model_ids = CANONICAL_MODELS if args.all else (args.model_id,)
    results = []
    for model_id in model_ids:
        if args.all and not (models_dir / f"{model_id}.pt").is_file():
            continue
        results.append(validate(models_dir, model_id))
    print(json.dumps({"validated": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
