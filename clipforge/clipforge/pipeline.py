"""Orchestration: each step is idempotent and recorded in SQLite, so a re-run resumes where it stopped."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, TypeVar

from . import ffmpeg
from .cache import atomic_write_text, text_hash, write_json
from .captions import build_ass, clip_words
from .config import Config
from .db import DB
from .highlights import select_clips
from .ingest import ingest
from .llm.base import LLMProvider, get_provider
from .models import MediaInfo, Transcript
from .reframe import center_crop
from .render import render_clip, thumbnail
from .report import build_report
from .transcribe import transcribe

log = logging.getLogger(__name__)
T = TypeVar("T")

SCHEMA_VERSION = 1


def _step(db: DB, job_id: str, name: str, fn: Callable[[], T], input_hash: Optional[str] = None) -> T:
    db.start_step(job_id, name, input_hash)
    try:
        result = fn()
    except BaseException as e:
        db.fail_step(job_id, name, f"{type(e).__name__}: {e}")
        raise
    db.finish_step(job_id, name)
    return result


def run(source: str, cfg: Config, llm: Optional[LLMProvider] = None,
        transcript: Optional[Transcript] = None) -> Path:
    """Full pipeline. `llm`/`transcript` can be injected (tests, reuse)."""
    if cfg.mode != "center":
        raise NotImplementedError(f"--mode {cfg.mode} arrives in phase 2; use --mode center")
    ffmpeg.set_ffmpeg_path(cfg.ffmpeg_path)
    db = DB(cfg.database)
    job_id = None
    try:
        media: MediaInfo = ingest(source, cfg)
        job = db.get_or_create_job(source, media.video_id, cfg.model_dump(mode="json"), cfg.output_hash(),
                                   media.media_hash)
        job_id = job["id"]
        db.set_job_status(job_id, "running")
        log.info("Job %s · %s · %.0fs · %dx%d", job_id[:8], media.title, media.duration, media.width, media.height)
        db.start_step(job_id, "ingest", media.media_hash)
        db.finish_step(job_id, "ingest", media.path)

        tr = transcript or _step(db, job_id, "transcribe", lambda: transcribe(media, cfg), media.media_hash)
        llm = llm or get_provider(cfg.llm.provider, cfg.llm)
        work = Path(cfg.cache_dir) / "media" / media.video_id

        sel_hash = text_hash(media.media_hash, cfg.output_hash(), tr.model)
        existing = db.get_clips(job_id)
        if existing and db.step_done(job_id, "select", sel_hash):
            clips = [json.loads(r["data_json"]) for r in existing]
            log.info("Selection already done (%d clips)", len(clips))
        else:
            cands = _step(db, job_id, "select", lambda: select_clips(tr, llm, cfg, cache_dir=work), sel_hash)
            clips = []
            for i, c in enumerate(cands, 1):
                clips.append({"clip_id": f"{media.video_id}_{i:02d}", "idx": i, "start": c.start, "end": c.end,
                              "duration": round(c.end - c.start, 3), **c.model_dump(exclude={"start", "end"})})
            db.replace_clips(job_id, clips)

        out_dir = Path(cfg.output_dir) / media.video_id
        _step(db, job_id, "render", lambda: _render_all(db, job_id, media, tr, clips, cfg, out_dir))
        report = _step(db, job_id, "export", lambda: _export(db, job_id, media, tr, clips, cfg, llm, out_dir))
        db.set_job_status(job_id, "done")
        return report
    except BaseException as e:
        if job_id:
            db.set_job_status(job_id, "failed", f"{type(e).__name__}: {e}")
        raise
    finally:
        db.close()


def _render_all(db: DB, job_id: str, media: MediaInfo, tr: Transcript, clips: list[dict], cfg: Config,
                out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    _remove_orphans(out_dir, len(clips))
    crop = center_crop(media.width, media.height)
    words = tr.words()
    status = {r["id"]: r["status"] for r in db.get_clips(job_id)}
    for c in clips:
        name = f"clip_{c['idx']:02d}"
        mp4 = out_dir / f"{name}.mp4"
        ass = out_dir / f"{name}.ass"
        if status.get(c["clip_id"]) in ("rendered", "exported") and mp4.exists():
            log.info("Clip cached: %s", mp4.name)
            continue
        for stale in (mp4, out_dir / f"{name}.jpg"):  # file from another config/selection
            stale.unlink(missing_ok=True)
        try:
            atomic_write_text(ass, build_ass(clip_words(words, c["start"], c["end"]), c["duration"], cfg.captions,
                                             hook_title=c["hook_title"], width=cfg.render.width,
                                             height=cfg.render.height))
            render_clip(Path(media.path), c["start"], c["end"], crop,
                        ass if cfg.captions.style != "none" or cfg.captions.hook else None, mp4, cfg)
            thumbnail(mp4, out_dir / f"{name}.jpg", at=min(1.5, c["duration"] / 2))
            db.update_clip(c["clip_id"], status="rendered", mp4_path=str(mp4), error=None)
        except Exception as e:
            db.update_clip(c["clip_id"], status="failed", error=f"{type(e).__name__}: {e}")
            log.error("Clip %s failed: %s", name, e)
    failed = [r for r in db.get_clips(job_id) if r["status"] == "failed"]
    if failed and len(failed) == len(clips):
        raise RuntimeError(f"All {len(clips)} clips failed to render; see errors above")


def _remove_orphans(out_dir: Path, n: int) -> None:
    """Drop clip_XX.* left by a previous run that produced more clips."""
    for f in out_dir.glob("clip_*.*"):
        stem = f.name.split(".")[0]
        if stem[5:].isdigit() and int(stem[5:]) > n:
            f.unlink(missing_ok=True)


def _export(db: DB, job_id: str, media: MediaInfo, tr: Transcript, clips: list[dict], cfg: Config,
            llm: LLMProvider, out_dir: Path) -> Path:
    status = {r["id"]: r["status"] for r in db.get_clips(job_id)}
    exported = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for c in clips:
        if status.get(c["clip_id"]) == "failed":
            continue
        name = f"clip_{c['idx']:02d}"
        meta = {
            "schema_version": SCHEMA_VERSION,
            "clip_id": c["clip_id"],
            "idx": c["idx"],
            "source": {"url": media.url, "path": None if media.url else media.path, "video_id": media.video_id,
                       "title": media.title, "duration": media.duration},
            "start": c["start"], "end": c["end"], "duration": c["duration"],
            "score": c["score"], "hook_title": c["hook_title"], "reason": c["reason"],
            "title": c["title"], "description": c["description"], "hashtags": c["hashtags"],
            "language": cfg.lang or tr.language,
            "translations": {},
            "files": {"video": f"{name}.mp4", "subtitles": f"{name}.ass", "thumbnail": f"{name}.jpg"},
            "render": {"w": cfg.render.width, "h": cfg.render.height, "reframe": cfg.mode,
                       "style": cfg.captions.style, "crf": cfg.render.crf, "lufs": cfg.render.lufs},
            "llm": {"provider": llm.name, "model": llm.model},
            "created_at": now,
        }
        path = out_dir / f"{name}.json"
        write_json(path, meta)
        db.update_clip(c["clip_id"], status="exported", json_path=str(path))
        exported.append(meta)
    exported.sort(key=lambda m: -m["score"])
    return build_report(out_dir, media.title, media.source, exported)
