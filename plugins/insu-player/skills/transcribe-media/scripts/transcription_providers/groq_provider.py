"""Groq transcription adapter."""

from __future__ import annotations

from pathlib import Path

from .base import response_to_dict


def transcribe(path: Path, *, model: str, language: str | None) -> dict[str, object]:
    try:
        from groq import Groq
    except ImportError as error:
        raise RuntimeError("Groq SDK is not installed in this Python environment") from error
    request: dict[str, object] = {
        "model": model,
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment", "word"],
        "temperature": 0,
    }
    if language:
        request["language"] = language
    with path.open("rb") as audio:
        response = Groq().audio.transcriptions.create(file=audio, **request)
    return response_to_dict(response)
