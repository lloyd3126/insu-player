"""ElevenLabs Scribe v2 adapter."""

from __future__ import annotations

from pathlib import Path

from .base import response_to_dict


def transcribe(path: Path, *, model: str, language: str | None) -> dict[str, object]:
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError as error:
        raise RuntimeError("ElevenLabs SDK is not installed in this Python environment") from error
    request: dict[str, object] = {
        "model_id": model,
        "timestamps_granularity": "word",
        "tag_audio_events": False,
        "diarize": False,
        "no_verbatim": False,
        "use_multi_channel": False,
    }
    if language:
        request["language_code"] = language
    with path.open("rb") as audio:
        response = ElevenLabs().speech_to_text.convert(file=audio, **request)
    return response_to_dict(response)
