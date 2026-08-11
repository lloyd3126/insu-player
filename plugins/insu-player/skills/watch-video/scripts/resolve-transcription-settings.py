#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path


LOCAL_MODELS = (
    "tiny",
    "tiny.en",
    "base",
    "base.en",
    "small",
    "small.en",
    "medium",
    "medium.en",
    "large-v1",
    "large-v2",
    "large-v3",
    "large-v3-turbo",
)

MODEL_CATALOG: dict[str, tuple[str, str, str | None]] = {
    **{
        f"local.openai-whisper.{model}": ("local", "openai-whisper", model)
        for model in LOCAL_MODELS
    },
    "cloud.openai.whisper-1": ("openai", "audio/transcriptions", "whisper-1"),
    "cloud.groq.whisper-large-v3": (
        "groq", "audio/transcriptions", "whisper-large-v3"
    ),
    "cloud.groq.whisper-large-v3-turbo": (
        "groq", "audio/transcriptions", "whisper-large-v3-turbo"
    ),
    "cloud.elevenlabs.scribe-v2": (
        "elevenlabs", "speech-to-text", "scribe_v2"
    ),
    "cloud.xai.speech-to-text": ("xai", "v1/stt", None),
    "cloud.openrouter.openai-whisper-large-v3": (
        "openrouter", "audio/transcriptions", "openai/whisper-large-v3"
    ),
}


def die(message: str) -> None:
    raise SystemExit(f"error: {message}")


def workspace_path(value: str) -> Path:
    workspace = Path(value).expanduser().resolve(strict=True)
    if not workspace.is_dir() or workspace.is_symlink():
        die("workspace must be a real directory")
    return workspace


def database_path(workspace: Path) -> Path:
    database = workspace / "app.db"
    if not database.exists():
        die("app.db is missing; initialize INSU Player before transcription")
    if database.is_symlink() or not database.is_file():
        die("app.db must be a regular file")
    return database


def resolve(database: Path) -> dict[str, str | None]:
    uri = f"file:{database.as_posix()}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT model_id FROM transcription_settings WHERE id = ?",
            ("active",),
        ).fetchone()
    except sqlite3.Error as error:
        die(f"cannot read current transcription settings: {error}")
    finally:
        if "connection" in locals():
            connection.close()

    if row is None:
        die("no transcription model is selected; choose one in 轉錄設定")

    model_id = row["model_id"]
    if not isinstance(model_id, str) or model_id not in MODEL_CATALOG:
        die("stored transcription model ID is unsupported")

    provider, service, model = MODEL_CATALOG[model_id]
    return {
        "modelId": model_id,
        "provider": provider,
        "service": service,
        "model": model,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read the one active transcription model from INSU Player app.db."
    )
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--format", choices=("json", "tsv"), default="json")
    args = parser.parse_args()

    payload = resolve(database_path(workspace_path(args.workspace)))
    if args.format == "tsv":
        values = [payload["provider"], payload["service"], payload["model"] or ""]
        if any("\t" in value or "\n" in value for value in values):
            die("stored transcription settings contain invalid control characters")
        print("\t".join(values))
    else:
        json.dump(payload, sys.stdout, ensure_ascii=False, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
