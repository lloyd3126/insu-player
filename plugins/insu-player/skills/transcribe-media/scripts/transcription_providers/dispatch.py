"""Provider dispatch with no automatic fallback."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def transcribe_chunk(
    provider: str,
    path: Path,
    *,
    model: str | None,
    language: str | None,
) -> dict[str, Any]:
    if provider == "openai":
        from .openai_provider import transcribe
    elif provider == "groq":
        from .groq_provider import transcribe
    elif provider == "elevenlabs":
        from .elevenlabs_provider import transcribe
    elif provider == "xai":
        from .xai_provider import transcribe
    elif provider == "openrouter":
        from .openrouter_provider import transcribe
    else:
        raise ValueError(f"unsupported cloud timing provider: {provider}")
    return transcribe(path, model=model, language=language)
