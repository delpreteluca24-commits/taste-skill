"""Step 6 — reframe to vertical.

Modes: center (static) · face (MediaPipe + Kalman/RTS smoothing; 2 speakers -> switch or split) ·
sports (optical-flow motion tracking). The result is a ReframePlan: per-panel crop size and a camera
path (left x per output frame) that render.py turns into ffmpeg `sendcmd` commands.
"""
from __future__ import annotations

import logging
import statistics
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from .tracking import interpolate, kmeans_1d_two, smooth_track, speaker_timeline

log = logging.getLogger(__name__)


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
                cy: float | None = None, zoom: float = 1.0) -> Crop:
    """Largest `aspect` window inside the source (divided by `zoom`), centred on (cx, cy), clamped to the frame."""
    if src_w <= 0 or src_h <= 0:
        raise ValueError("source size must be positive")
    if src_w / src_h > aspect:  # source wider than target (e.g. 16:9) -> crop width
        h = _even(src_h / zoom)
        w = _even(h * aspect)
    else:  # source taller/narrower -> crop height
        w = _even(src_w / zoom)
        h = _even(w / aspect)
    cx = src_w / 2 if cx is None else cx
    cy = src_h / 2 if cy is None else cy
    x = min(max(0, cx - w / 2), src_w - w)
    y = min(max(0, cy - h / 2), src_h - h)
    return Crop(w=w, h=h, x=_even(x) if x >= 2 else 0, y=_even(y) if y >= 2 else 0)


def center_crop(src_w: int, src_h: int, aspect: float = 9 / 16) -> Crop:
    return crop_window(src_w, src_h, aspect)


@dataclass
class Panel:
    crop_w: int
    crop_h: int
    y: int
    out_w: int
    out_h: int
    path: list[tuple[float, int]]  # (t, crop left x) — one entry per output frame, or a single static entry

    @property
    def x0(self) -> int:
        return self.path[0][1] if self.path else 0

    @property
    def dynamic(self) -> bool:
        return len({x for _, x in self.path}) > 1


@dataclass
class ReframePlan:
    layout: str  # single | switch | split
    panels: list[Panel]
    info: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ReframePlan":
        return cls(layout=d["layout"], info=d.get("info", {}),
                   panels=[Panel(**{**p, "path": [tuple(e) for e in p["path"]]}) for p in d["panels"]])

    def sendcmd(self) -> str:
        """ffmpeg sendcmd script: move `crop@pN` x only when it changes."""
        lines = []
        for i, p in enumerate(self.panels):
            last = None
            for t, x in p.path:
                if x != last:
                    lines.append(f"{t:.3f} crop@p{i} x {x};")
                    last = x
        lines.sort(key=lambda l: float(l.split()[0]))
        return "\n".join(lines) + "\n"


def _to_left(cx: float, crop_w: int, src_w: int) -> int:
    x = min(max(0.0, cx - crop_w / 2), src_w - crop_w)
    return int(x) // 2 * 2


def static_plan(src_w: int, src_h: int, out_w: int, out_h: int, layout: str = "single") -> ReframePlan:
    c = crop_window(src_w, src_h, out_w / out_h)
    return ReframePlan(layout, [Panel(c.w, c.h, c.y, out_w, out_h, [(0.0, c.x)])], {"mode": "center"})


def _path(ts, zs, crop_w, src_w, fps, duration, rc, hard_cuts=(), smooth=1.0) -> list[tuple[float, int]]:
    xs = smooth_track(ts, zs, default=src_w / 2, deadzone=rc.deadzone * crop_w * smooth,
                      max_speed=rc.max_speed * src_w, q=2e4 / smooth, r=400.0 * smooth)
    return [(t, _to_left(x, crop_w, src_w)) for t, x in interpolate(ts, xs, fps, duration, hard_cuts)]


def _pick_primary(faces, prev_cx: Optional[float], frame_w: float):
    """Biggest face, penalising jumps away from the previous subject (keeps identity stable)."""
    def score(f):
        jump = abs(f.cx - prev_cx) / frame_w if prev_cx is not None else 0.0
        return f.w * f.h * (1.0 - min(0.8, jump))
    return max(faces, key=score) if faces else None


def plan_face(samples: list[tuple[float, list, list[float]]], src_w: int, src_h: int, out_w: int, out_h: int,
              fps: float, duration: float, rc, allow_split: bool = True) -> ReframePlan:
    """samples: (t, faces in source px, mouth activity per face). Pure function: unit-testable."""
    ts = [s[0] for s in samples]
    single = crop_window(src_w, src_h, out_w / out_h)
    n = len(samples)
    with_faces = sum(1 for _, f, _ in samples if f)
    multi = [s for s in samples if len(s[1]) >= 2]
    info = {"mode": "face", "samples": n, "face_ratio": round(with_faces / n, 2) if n else 0,
            "multi_ratio": round(len(multi) / n, 2) if n else 0}

    if n == 0 or with_faces == 0:
        log.info("No faces found: centre crop")
        p = static_plan(src_w, src_h, out_w, out_h)
        p.info.update(info)
        return p

    two = False
    if rc.speakers != "single" and len(multi) / n >= 0.4:
        cxs = [f.cx for _, fs, _ in multi for f in sorted(fs, key=lambda f: -f.w * f.h)[:2]]
        left_c, right_c = kmeans_1d_two(cxs)
        two = right_c - left_c > single.w * 0.6  # both don't fit in one vertical crop
        info.update(left_cx=round(left_c), right_cx=round(right_c))

    if not two:
        zs, prev = [], None
        for _, fs, _ in samples:
            f = _pick_primary(fs, prev, src_w)
            prev = f.cx if f else prev
            zs.append(f.cx if f else None)
        path = _path(ts, zs, single.w, src_w, fps, duration, rc)
        return ReframePlan("single", [Panel(single.w, single.h, single.y, out_w, out_h, path)], info)

    # Two speakers: per sample, face nearest each cluster centre + its mouth activity
    za, zb, act_a, act_b = [], [], [], []
    for _, fs, acts in samples:
        best = {0: (None, 0.0), 1: (None, 0.0)}
        for f, a in zip(fs, acts or [0.0] * len(fs)):
            k = 0 if abs(f.cx - left_c) <= abs(f.cx - right_c) else 1
            cur = best[k][0]
            if cur is None or f.w * f.h > cur.w * cur.h:
                best[k] = (f, a)
        za.append(best[0][0].cx if best[0][0] else None)
        zb.append(best[1][0].cx if best[1][0] else None)
        act_a.append(best[0][1])
        act_b.append(best[1][1])

    layout = "split" if (rc.speakers == "split" and allow_split) else "switch"
    if layout == "split":
        ph = _even(out_h / 2)
        cy_all = [f.cy for _, fs, _ in samples for f in fs]
        pc = crop_window(src_w, src_h, out_w / ph, cy=statistics.median(cy_all), zoom=1.25)
        panels = [Panel(pc.w, pc.h, pc.y, out_w, ph, _path(ts, z, pc.w, src_w, fps, duration, rc)) for z in (za, zb)]
        return ReframePlan("split", panels, info)

    who = speaker_timeline(ts, act_a, act_b, rc.min_shot_s)
    cuts = [ts[i] for i in range(1, n) if who[i] != who[i - 1]]
    # smooth each shot on its own so the camera cuts instead of panning between speakers
    xs_all: list[float] = []
    start = 0
    for end in [i for i in range(1, n) if who[i] != who[i - 1]] + [n]:
        src = za if who[start] == 0 else zb
        seg_ts, seg_z = ts[start:end], src[start:end]
        centre = left_c if who[start] == 0 else right_c
        xs_all += smooth_track(seg_ts, seg_z, default=centre, deadzone=rc.deadzone * single.w,
                               max_speed=rc.max_speed * src_w)
        start = end
    path = [(t, _to_left(x, single.w, src_w)) for t, x in interpolate(ts, xs_all, fps, duration, cuts)]
    info.update(switches=len(cuts))
    return ReframePlan("switch", [Panel(single.w, single.h, single.y, out_w, out_h, path)], info)


def plan_reframe(video: Path, src_w: int, src_h: int, start: float, end: float, cfg, out_w: int, out_h: int,
                 fps: float, allow_split: bool = True) -> ReframePlan:
    """Analyse the clip and build its camera plan. Falls back to centre crop if detection is unavailable."""
    from . import detect

    rc = cfg.reframe
    duration = end - start
    if cfg.mode == "center":
        return static_plan(src_w, src_h, out_w, out_h)
    scale = src_w / min(src_w, rc.analysis_width)
    try:
        if cfg.mode == "sports":
            ts, zs, prev = [], [], None
            for t, frame, _ in detect.sample_frames(video, start, end, rc.analysis_fps, rc.analysis_width):
                c = detect.motion_center(prev, frame)
                ts.append(t)
                zs.append(c * scale if c is not None else None)
                prev = frame
            single = crop_window(src_w, src_h, out_w / out_h)
            path = _path(ts, zs, single.w, src_w, fps, duration, rc, smooth=2.0) if ts else [(0.0, single.x)]
            found = sum(z is not None for z in zs)
            return ReframePlan("single", [Panel(single.w, single.h, single.y, out_w, out_h, path)],
                               {"mode": "sports", "samples": len(ts), "motion_ratio": round(found / max(1, len(ts)), 2)})

        det = detect.FaceDetector(Path(cfg.cache_dir), rc.face_model_url, rc.min_face_conf)
        samples = []
        try:
            for t, frame, nxt in detect.sample_frames(video, start, end, rc.analysis_fps, rc.analysis_width, pairs=True):
                faces = det.detect(frame)
                acts = [detect.mouth_activity(frame, nxt, f) for f in faces]
                faces = [detect.Face(f.x * scale, f.y * scale, f.w * scale, f.h * scale, f.score) for f in faces]
                samples.append((t, faces, acts))
        finally:
            det.close()
        return plan_face(samples, src_w, src_h, out_w, out_h, fps, duration, rc, allow_split)
    except detect.DetectError as e:
        log.warning("Reframe '%s' unavailable (%s): centre crop", cfg.mode, e)
        return static_plan(src_w, src_h, out_w, out_h)
