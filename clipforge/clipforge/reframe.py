"""Step 6 — reframe to 9:16. MVP: static centre crop. Phase 2: face/sports tracking feed `cx`."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Crop:
    w: int
    h: int
    x: int
    y: int

    def filter(self, out_w: int, out_h: int) -> str:
        return f"crop={self.w}:{self.h}:{self.x}:{self.y},scale={out_w}:{out_h}:flags=lanczos,setsar=1"


def _even(v: float) -> int:
    return max(2, int(v) // 2 * 2)


def crop_window(src_w: int, src_h: int, aspect: float = 9 / 16, cx: float | None = None,
                cy: float | None = None) -> Crop:
    """Largest `aspect` window inside the source, centred on (cx, cy) and clamped to the frame."""
    if src_w <= 0 or src_h <= 0:
        raise ValueError("source size must be positive")
    if src_w / src_h > aspect:  # source wider than target (e.g. 16:9) -> crop width
        h = _even(src_h)
        w = _even(src_h * aspect)
    else:  # source taller/narrower -> crop height
        w = _even(src_w)
        h = _even(src_w / aspect)
    cx = src_w / 2 if cx is None else cx
    cy = src_h / 2 if cy is None else cy
    x = min(max(0, cx - w / 2), src_w - w)
    y = min(max(0, cy - h / 2), src_h - h)
    return Crop(w=w, h=h, x=_even(x) if x >= 2 else 0, y=_even(y) if y >= 2 else 0)


def center_crop(src_w: int, src_h: int, aspect: float = 9 / 16) -> Crop:
    return crop_window(src_w, src_h, aspect)
