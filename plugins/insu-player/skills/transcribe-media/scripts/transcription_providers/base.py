"""Shared provider identities and response helpers."""

from __future__ import annotations

import re
from typing import Any


CLOUD_PROVIDERS = ("openai", "groq", "elevenlabs", "xai", "openrouter")
PROVIDER_API_KEYS = {
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}
PROVIDER_SERVICES = {
    "local": "openai-whisper",
    "openai": "audio/transcriptions",
    "groq": "audio/transcriptions",
    "elevenlabs": "speech-to-text",
    "xai": "v1/stt",
    "openrouter": "audio/transcriptions",
}
SIMPLE_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
OPENROUTER_MODEL_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"
)


def response_to_dict(response: object) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    elif isinstance(response, dict):
        payload = response
    else:
        payload = {
            "text": getattr(response, "text", ""),
            "segments": getattr(response, "segments", None),
            "words": getattr(response, "words", None),
            "language": getattr(response, "language", None),
            "language_code": getattr(response, "language_code", None),
            "duration": getattr(response, "duration", None),
        }
    if not isinstance(payload, dict):
        raise ValueError("unexpected transcription response")
    return payload


def validate_model(provider: str, model: str | None) -> str | None:
    if provider == "xai":
        if model not in {None, ""}:
            raise ValueError("xAI /v1/stt does not accept a model parameter")
        return None
    if not isinstance(model, str) or not model:
        raise ValueError(f"{provider} requires an explicit model")
    if provider == "openrouter":
        if not OPENROUTER_MODEL_PATTERN.fullmatch(model):
            raise ValueError("OpenRouter model must use a strict provider/model ID")
        if model != "openai/whisper-large-v3":
            raise ValueError("OpenRouter word timing is locked to openai/whisper-large-v3")
    elif not SIMPLE_MODEL_PATTERN.fullmatch(model):
        raise ValueError(f"invalid {provider} model ID")
    if provider == "openai" and model != "whisper-1":
        raise ValueError("OpenAI word timing currently requires whisper-1")
    if provider == "groq" and model not in {
        "whisper-large-v3",
        "whisper-large-v3-turbo",
    }:
        raise ValueError("unsupported Groq speech-to-text model")
    if provider == "elevenlabs" and model != "scribe_v2":
        raise ValueError("ElevenLabs word timing currently requires scribe_v2")
    return model


def processor_identity(provider: str, model: str | None) -> dict[str, str | None]:
    if provider not in PROVIDER_SERVICES:
        raise ValueError(f"unsupported timing provider: {provider}")
    return {
        "provider": provider,
        "service": PROVIDER_SERVICES[provider],
        "model": validate_model(provider, model),
    }
