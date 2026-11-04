"""Thin ffmpeg wrapper: binary discovery, probing, progress, explicit errors."""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

from rich.progress import BarColumn, Progress, TextColumn, TimeRemainingColumn

log = logging.getLogger(__name__)


class FFmpegError(RuntimeError):
    pass


_FFMPEG: Optional[str] = None


def set_ffmpeg_path(path: Optional[str]) -> None:
    global _FFMPEG
    _FFMPEG = path


def ffmpeg_bin() -> str:
    if _FFMPEG:
        return _FFMPEG
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:  # optional fallback, handy on Windows and in CI
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise FFmpegError(
            "ffmpeg not found. Install it (see README) or set `ffmpeg_path` in config.yaml."
        ) from None


def ffprobe_bin() -> Optional[str]:
    ff = Path(ffmpeg_bin())
    sibling = ff.with_name(ff.name.replace("ffmpeg", "ffprobe"))
    if sibling.exists() and sibling != ff:
        return str(sibling)
    return shutil.which("ffprobe")


def has_filter(name: str) -> bool:
    out = subprocess.run([ffmpeg_bin(), "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return re.search(rf"^\s*\S+\s+{re.escape(name)}\s", out, re.M) is not None


@dataclass
class ProbeResult:
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool


def probe(path: Path) -> ProbeResult:
    path = Path(path)
    if not path.exists():
        raise FFmpegError(f"Input file not found: {path}")
    fp = ffprobe_bin()
    if fp:
        r = subprocess.run(
            [fp, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            raise FFmpegError(f"ffprobe failed on {path}: {r.stderr.strip()}")
        data = json.loads(r.stdout)
        v = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
        if v is None:
            raise FFmpegError(f"No video stream in {path}")
        num, _, den = v.get("avg_frame_rate", "0/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 0.0
        return ProbeResult(
            duration=float(data["format"].get("duration") or v.get("duration") or 0),
            width=int(v["width"]), height=int(v["height"]), fps=fps,
            has_audio=any(s["codec_type"] == "audio" for s in data["streams"]),
        )
    # Fallback: parse `ffmpeg -i` banner (ffprobe missing, e.g. imageio-ffmpeg)
    r = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    return parse_ffmpeg_banner(r.stderr, path)


def parse_ffmpeg_banner(text: str, path: Path | str = "") -> ProbeResult:
    d = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    v = re.search(r"Stream #.*?Video:.*?(\d{2,5})x(\d{2,5})", text)
    if not d or not v:
        raise FFmpegError(f"Could not probe {path}: {text.strip()[-400:]}")
    f = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
    return ProbeResult(
        duration=int(d[1]) * 3600 + int(d[2]) * 60 + float(d[3]),
        width=int(v[1]), height=int(v[2]),
        fps=float(f[1]) if f else 0.0,
        has_audio=re.search(r"Stream #.*?Audio:", text) is not None,
    )


def run(args: Sequence[str], duration: Optional[float] = None, desc: str = "ffmpeg", cwd: Optional[Path] = None) -> str:
    """Run ffmpeg with a progress bar. Returns stderr text. Raises FFmpegError with the log tail."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    log.debug("ffmpeg: %s", " ".join(cmd))
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err, text=True, cwd=cwd)
        with Progress(
            TextColumn("[cyan]{task.description}"), BarColumn(), TextColumn("{task.percentage:>3.0f}%"),
            TimeRemainingColumn(), transient=True, disable=not duration,
        ) as bar:
            task = bar.add_task(desc, total=duration or 1)
            assert proc.stdout is not None
            for line in proc.stdout:
                if line.startswith("out_time_us=") and duration:
                    try:
                        bar.update(task, completed=min(duration, int(line.split("=")[1]) / 1e6))
                    except ValueError:
                        pass
        code = proc.wait()
        err.seek(0)
        stderr = err.read()
    if code != 0:
        tail = "\n".join(stderr.strip().splitlines()[-25:])
        raise FFmpegError(f"{desc} failed (exit {code}):\n{tail}")
    return stderr


def escape_filter_path(path: Path | str) -> str:
    """Escape a path for use inside an ffmpeg filter argument (handles Windows drive colons)."""
    p = str(path).replace("\\", "/")
    p = p.replace(":", r"\:").replace("'", r"'\''")
    return f"'{p}'"
