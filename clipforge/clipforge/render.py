"""Step 7b — render: dynamic crop (sendcmd), split/gameplay stacking, .ass subtitles, loudnorm, h264/aac."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import ffmpeg
from .reframe import ReframePlan

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


@dataclass
class GameplaySource:
    path: Path
    offset: float  # seconds into the gameplay video
    height: int  # bottom panel height in output px


def build_filtergraph(plan: ReframePlan, cmd_name: Optional[str], ass_name: Optional[str],
                      fonts_dir: Optional[Path], gameplay: Optional[GameplaySource], out_w: int) -> str:
    """ffmpeg -filter_complex for any layout. Output label: [v]."""
    chains = []
    head = "[0:v]" + (f"sendcmd=f={ffmpeg.escape_filter_path(cmd_name)}," if cmd_name else "")
    fps = ",fps=30" if gameplay else ""  # vstack needs matching rates

    def panel(i: int, p) -> str:
        return (f"crop@p{i}={p.crop_w}:{p.crop_h}:{p.x0}:{p.y},scale={p.out_w}:{p.out_h}:flags=lanczos,"
                f"setsar=1{fps},format=yuv420p")

    if len(plan.panels) == 1:
        chains.append(f"{head}{panel(0, plan.panels[0])}[main]")
    else:
        chains.append(f"{head}split={len(plan.panels)}" + "".join(f"[s{i}]" for i in range(len(plan.panels))))
        for i, p in enumerate(plan.panels):
            chains.append(f"[s{i}]{panel(i, p)}[p{i}]")
        chains.append("".join(f"[p{i}]" for i in range(len(plan.panels))) + f"vstack=inputs={len(plan.panels)}[main]")
    last = "[main]"
    if gameplay:
        gh = gameplay.height
        chains.append(f"[1:v]scale={out_w}:{gh}:force_original_aspect_ratio=increase,crop={out_w}:{gh},"
                      f"setsar=1,fps=30,format=yuv420p[game]")
        chains.append("[main][game]vstack=inputs=2[stack]")
        last = "[stack]"
    if ass_name:
        sub = f"ass={ffmpeg.escape_filter_path(ass_name)}"
        if fonts_dir:
            sub += f":fontsdir={ffmpeg.escape_filter_path(Path(fonts_dir).resolve())}"
        chains.append(f"{last}{sub}[v]")
    else:
        chains.append(f"{last}null[v]")
    return ";".join(chains)


def build_render_args(src: Path, start: float, duration: float, filtergraph: str, out: Path, rc,
                      audio_filter: str, gameplay: Optional[GameplaySource] = None) -> list[str]:
    args = ["-ss", f"{start:.3f}", "-i", str(src)]
    if gameplay:
        args += ["-stream_loop", "-1", "-ss", f"{gameplay.offset:.3f}", "-i", str(gameplay.path)]
    return args + [
        "-t", f"{duration:.3f}",
        "-filter_complex", filtergraph,
        "-map", "[v]", "-map", "0:a:0?",  # gameplay audio is never mapped (muted)
        "-af", f"{audio_filter},aresample=48000",
        "-c:v", "libx264", "-preset", rc.preset, "-crf", str(rc.crf), "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-fps_mode", "cfr",
        "-c:a", "aac", "-b:a", rc.audio_bitrate, "-ar", "48000",
        "-movflags", "+faststart",
        str(out),
    ]


_LOUDNESS: dict[tuple, Optional[dict]] = {}


def render_clip(src: Path, start: float, end: float, plan: ReframePlan, ass_path: Optional[Path], out: Path, cfg,
                gameplay: Optional[GameplaySource] = None) -> Path:
    """Writes to a temp file, then renames: a crash never leaves a half-written clip_XX.mp4."""
    out = Path(out)
    rc = cfg.render
    duration = end - start
    key = (str(src), round(start, 3), round(duration, 3), rc.lufs, rc.true_peak, rc.lra)
    if key not in _LOUDNESS:  # translated variants reuse the measurement
        _LOUDNESS[key] = measure_loudness(Path(src), start, duration, rc)
    tmp = out.with_name(out.stem + ".tmp.mp4")
    cmd_name = None
    if any(p.dynamic for p in plan.panels):
        cmd_file = out.with_name(out.stem + ".cmd")
        cmd_file.write_text(plan.sendcmd(), encoding="utf-8")
        cmd_name = cmd_file.name
    # Run inside the output dir so .ass/.cmd paths are relative (avoids Windows drive-colon escaping)
    graph = build_filtergraph(plan, cmd_name, ass_path.name if ass_path else None,
                              cfg.captions.fonts_dir if ass_path else None, gameplay, rc.width)
    args = build_render_args(Path(src).resolve(), start, duration, graph, Path(tmp.name), rc,
                             loudnorm_filter(rc, _LOUDNESS[key]),
                             GameplaySource(Path(gameplay.path).resolve(), gameplay.offset, gameplay.height)
                             if gameplay else None)
    try:
        ffmpeg.run(args, duration=duration, desc=f"Rendering {out.name}", cwd=out.parent)
    finally:
        if cmd_name:
            (out.parent / cmd_name).unlink(missing_ok=True)
    tmp.replace(out)
    return out


def thumbnail(video: Path, out: Path, at: float = 1.5) -> Path:
    if out.exists():
        return out
    ffmpeg.run(["-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(out)],
               desc="Thumbnail")
    return out
