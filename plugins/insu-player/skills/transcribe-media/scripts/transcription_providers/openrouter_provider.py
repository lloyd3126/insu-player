"""OpenRouter OpenAI-compatible transcription adapter."""

from __future__ import annotations

import os
from pathlib import Path

from .base import response_to_dict


def transcribe(path: Path, *, model: str, language: str | None) -> dict[str, object]:
    try:
        from openai import OpenAI
    except ImportError as error:
        raise RuntimeError("OpenAI SDK is required for the OpenRouter adapter") from error
    request: dict[str, object] = {
        "model": model,
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment", "word"],
    }
    if language:
        request["language"] = language
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )
    with path.open("rb") as audio:
        response = client.audio.transcriptions.create(file=audio, **request)
    payload = response_to_dict(response)
    if not isinstance(payload.get("words"), list) or not payload["words"]:
        raise RuntimeError(
            "OpenRouter route did not return required word timestamps; no fallback was used"
        )
    return payload
