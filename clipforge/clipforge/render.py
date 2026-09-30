"""Step 7b — render: crop/scale, burn .ass subtitles, two-pass loudnorm, h264/aac."""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from . import ffmpeg
from .reframe import Crop

log = logging.getLogger(__name__)


def measure_loudness(src: Path, start: float, duration: float, rc) -> dict | None:
    """loudnorm pass 1. Returns measured values, or None if measurement fails (falls back to 1-pass)."""
    af = f"loudnorm=I={rc.lufs}:TP={rc.true_peak}:LRA={rc.lra}:print_format=json"
    try:
        err = ffmpeg.run(["-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(src), "-vn", "-af", af,
                          "-f", "null", "-"], desc="Measuring loudness")
    except ffmpeg.FFmpegError as e:
        log.warning("Loudness measurement failed, using single pass: %s", e)
        return None
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err, re.S)
    if not m:
        return None
    data = json.loads(m.group(0))
    if any(data.get(k) in (None, "-inf", "inf") for k in ("input_i", "input_tp", "input_lra", "input_thresh")):
        return None  # silent clip: loudnorm cannot measure
    return data


def loudnorm_filter(rc, measured: dict | None) -> str:
    base = f"loudnorm=I={rc.lufs}:TP={rc.true_peak}:LRA={rc.lra}"
    if not measured:
        return base
    return (f"{base}:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
            f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}:linear=true")


def build_render_args(src: Path, start: float, duration: float, crop: Crop, ass_name: str | None,
                      fonts_dir: Path | None, out: Path, rc, audio_filter: str) -> list[str]:
    vf = crop.filter(rc.width, rc.height)
    if ass_name:
        vf += f",ass={ffmpeg.escape_filter_path(ass_name)}"
        if fonts_dir:
            vf += f":fontsdir={ffmpeg.escape_filter_path(Path(fonts_dir).resolve())}"
    return [
        "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{duration:.3f}",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", vf,
        "-af", f"{audio_filter},aresample=48000",
        "-c:v", "libx264", "-preset", rc.preset, "-crf", str(rc.crf), "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-fps_mode", "cfr",
        "-c:a", "aac", "-b:a", rc.audio_bitrate, "-ar", "48000",
        "-movflags", "+faststart",
        str(out),
    ]


def render_clip(src: Path, start: float, end: float, crop: Crop, ass_path: Path | None, out: Path, cfg) -> Path:
    """Writes to a temp file, then renames: a crash never leaves a half-written clip_XX.mp4."""
    out = Path(out)
    rc = cfg.render
    duration = end - start
    measured = measure_loudness(Path(src), start, duration, rc)
    tmp = out.with_name(out.stem + ".tmp.mp4")
    # Run inside the output dir so the .ass path is relative (avoids Windows drive-colon escaping)
    args = build_render_args(
        Path(src).resolve(), start, duration, crop,
        ass_path.name if ass_path else None,
        cfg.captions.fonts_dir if ass_path else None,
        Path(tmp.name), rc, loudnorm_filter(rc, measured),
    )
    ffmpeg.run(args, duration=duration, desc=f"Rendering {out.name}", cwd=out.parent)
    tmp.replace(out)
    return out


def thumbnail(video: Path, out: Path, at: float = 1.5) -> Path:
    if out.exists():
        return out
    ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(out)],
               desc="Thumbnail")
    return out
