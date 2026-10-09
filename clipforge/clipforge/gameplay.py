"""Gameplay split: pick a gameplay video (file or folder) and a start offset, deterministically per clip."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

from . import ffmpeg
from .render import GameplaySource

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}


def list_gameplay(path: Path) -> list[Path]:
    path = Path(path).expanduser()
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(p for p in path.iterdir() if p.suffix.lower() in VIDEO_EXT)
    raise FileNotFoundError(f"Gameplay path not found: {path}")


def pick_gameplay(path: Path, clip_id: str, clip_duration: float, height: int,
                  duration_of=lambda p: ffmpeg.probe(p).duration) -> Optional[GameplaySource]:
    files = list_gameplay(path)
    if not files:
        raise FileNotFoundError(f"No gameplay videos ({', '.join(sorted(VIDEO_EXT))}) in {path}")
    h = int(hashlib.sha256(clip_id.encode()).hexdigest(), 16)
    chosen = files[h % len(files)]
    room = max(0.0, duration_of(chosen) - clip_duration)
    offset = (h >> 16) % int(room) if room >= 1 else 0.0  # shorter than the clip: it loops
    return GameplaySource(path=chosen, offset=float(offset), height=height)
