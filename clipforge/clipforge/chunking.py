"""Step 3 — split the transcript into overlapping windows that fit the LLM context."""
from __future__ import annotations

from .models import Segment


def windows(segments: list[Segment], window_s: float, overlap_s: float) -> list[list[Segment]]:
    if not segments:
        return []
    if overlap_s >= window_s:
        raise ValueError("overlap_s must be smaller than window_s")
    out: list[list[Segment]] = []
    t0 = segments[0].start
    end_time = segments[-1].end
    while True:
        t1 = t0 + window_s
        win = [s for s in segments if s.start >= t0 and s.start < t1]
        if win:
            out.append(win)
        if t1 >= end_time:
            break
        t0 = t1 - overlap_s
    return out


def fmt_ts(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def render_window(win: list[Segment]) -> str:
    """One line per segment: `[id] (mm:ss, 4.2s) text` — the LLM answers with ids."""
    return "\n".join(f"[{s.id}] ({fmt_ts(s.start)}, {s.end - s.start:.1f}s) {s.text}" for s in win)
