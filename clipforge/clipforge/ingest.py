"""Step 1 — ingest: download a URL with yt-dlp (or take a local file) and extract 16 kHz mono audio."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

from . import ffmpeg
from .cache import media_hash, read_json, write_json
from .models import MediaInfo

log = logging.getLogger(__name__)


class IngestError(RuntimeError):
    pass


def is_url(source: str) -> bool:
    return re.match(r"^https?://", source.strip(), re.I) is not None


def slugify(text: str, max_len: int = 40) -> str:
    s = re.sub(r"[^\w-]+", "-", text.strip().lower(), flags=re.UNICODE).strip("-")
    return (s[:max_len].rstrip("-")) or "video"


def build_format(formats: list[dict], lang: Optional[str], max_height: int) -> str:
    """yt-dlp format selector; picks the audio track in `lang` when the video has several."""
    video = f"bv*[height<={max_height}]"
    fallback = f"b[height<={max_height}]/b"
    if lang:
        langs = {(f.get("language") or "").lower() for f in formats if f.get("acodec") not in (None, "none")}
        if any(l.startswith(lang.lower()) for l in langs if l):
            return f"{video}+ba[language^={lang}]/{video}+ba/{fallback}"
    return f"{video}+ba/{fallback}"


def _download(url: str, workdir: Path, lang: Optional[str], max_height: int) -> tuple[str, str, Path]:
    try:
        import yt_dlp
    except ImportError as e:
        raise IngestError("yt-dlp is not installed: pip install yt-dlp") from e

    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "ffmpeg_location": ffmpeg.ffmpeg_bin()}
    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise IngestError(f"yt-dlp could not read {url}: {e}. Try `pip install -U yt-dlp`.") from e

    video_id = slugify(f"{info.get('extractor_key', 'web')}-{info['id']}", 60)
    title = info.get("title") or video_id
    target_dir = workdir / video_id
    target = target_dir / "source.mp4"
    if target.exists() and target.stat().st_size > 0:
        log.info("Download cached: %s", target)
        return video_id, title, target

    target_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        **base_opts,
        "format": build_format(info.get("formats") or [], lang, max_height),
        "merge_output_format": "mp4",
        "outtmpl": str(target_dir / "download.%(ext)s"),
        "quiet": False,
        "noprogress": False,
    }
    log.info("Downloading %s", url)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise IngestError(f"Download failed for {url}: {e}") from e
    produced = sorted(target_dir.glob("download.*"), key=lambda p: p.stat().st_size, reverse=True)
    produced = [p for p in produced if p.suffix not in (".part", ".ytdl")]
    if not produced:
        raise IngestError(f"yt-dlp produced no file for {url}")
    produced[0].replace(target)
    return video_id, title, target


def ingest(source: str, cfg) -> MediaInfo:
    """Idempotent: re-running reuses the downloaded video, extracted audio and metadata."""
    workdir = Path(cfg.cache_dir) / "media"
    if is_url(source):
        video_id, title, video_path = _download(source, workdir, cfg.lang, cfg.max_download_height)
        url = source
    else:
        video_path = Path(source).expanduser().resolve()
        if not video_path.is_file():
            raise IngestError(f"File not found: {video_path}")
        url = None
        title = video_path.stem
        video_id = f"{slugify(video_path.stem)}-{media_hash(video_path)[:8]}"

    meta_path = workdir / video_id / "media.json"
    cached = read_json(meta_path)
    if cached and Path(cached["path"]) == video_path and Path(cached["audio_path"]).exists():
        return MediaInfo.model_validate(cached)

    info = ffmpeg.probe(video_path)
    if not info.has_audio:
        raise IngestError(f"{video_path} has no audio track: nothing to transcribe")
    audio_path = workdir / video_id / "audio.wav"
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = audio_path.with_name("audio.tmp.wav")
    ffmpeg.run(
        ["-i", str(video_path), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)],
        duration=info.duration, desc="Extracting audio",
    )
    tmp.replace(audio_path)

    media = MediaInfo(
        video_id=video_id, title=title, source=source, url=url, path=str(video_path),
        audio_path=str(audio_path), media_hash=media_hash(video_path),
        duration=info.duration, width=info.width, height=info.height,
    )
    write_json(meta_path, media.model_dump())
    return media
