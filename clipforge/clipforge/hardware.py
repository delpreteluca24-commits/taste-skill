"""CUDA auto-detection for faster-whisper (via ctranslate2, no torch needed)."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception as e:  # missing CUDA libs raise here on some systems
        log.debug("CUDA check failed: %s", e)
        return False


def resolve_whisper(model: str, device: str, compute_type: str) -> tuple[str, str, str]:
    """Resolve 'auto' values to (model, device, compute_type)."""
    if device == "auto":
        device = "cuda" if cuda_available() else "cpu"
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"
    if model == "auto":
        model = "large-v3-turbo" if device == "cuda" else "small"
    return model, device, compute_type
