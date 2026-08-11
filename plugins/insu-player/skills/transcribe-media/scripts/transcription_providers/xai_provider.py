"""xAI fixed /v1/stt adapter."""

from __future__ import annotations

import os
from pathlib import Path

from .base import response_to_dict


def transcribe(path: Path, *, model: None, language: str | None) -> dict[str, object]:
    del model
    try:
        import httpx
    except ImportError as error:
        raise RuntimeError("HTTP client is not installed in this Python environment") from error
    headers = {"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"}
    form_data = [("format", "true" if language else "false")]
    if language:
        form_data.append(("language", language))
    form_data.append(("filler_words", "true"))
    # Options are encoded before files by httpx. xAI requires file to be the
    # final multipart field, otherwise preceding options may be ignored.
    with path.open("rb") as audio:
        response = httpx.post(
            "https://api.x.ai/v1/stt",
            headers=headers,
            data=form_data,
            files={"file": (path.name, audio, "audio/mpeg")},
            timeout=120,
        )
    response.raise_for_status()
    return response_to_dict(response.json())
