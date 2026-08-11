"""Strict cloud speech-to-text provider adapters."""

from .base import (
    CLOUD_PROVIDERS,
    PROVIDER_API_KEYS,
    PROVIDER_SERVICES,
    processor_identity,
    validate_model,
)
from .dispatch import transcribe_chunk

__all__ = [
    "CLOUD_PROVIDERS",
    "PROVIDER_API_KEYS",
    "PROVIDER_SERVICES",
    "processor_identity",
    "transcribe_chunk",
    "validate_model",
]
