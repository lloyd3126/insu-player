"""OpenAI transcription adapter."""

from __future__ import annotations

from pathlib import Path

from .base import response_to_dict


def transcribe(path: Path, *, model: str, language: str | None) -> dict[str, object]:
    try:
        from openai import OpenAI
    except ImportError as error:
        raise RuntimeError("OpenAI SDK is not installed in this Python environment") from error
    request: dict[str, object] = {
        "model": model,
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment", "word"],
    }
    if language:
        request["language"] = language
    with path.open("rb") as audio:
        response = OpenAI().audio.transcriptions.create(file=audio, **request)
    return response_to_dict(response)
