"""Orchestration: each step is idempotent and recorded in SQLite, so a re-run resumes where it stopped."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, TypeVar

from . import ffmpeg
from .cache import atomic_write_text, read_json, text_hash, write_json
from .captions import build_ass, clip_words
from .config import Config
from .db import DB
from .highlights import select_clips
from .ingest import ingest
from .llm.base import LLMProvider, get_provider
from .gameplay import pick_gameplay
from .models import MediaInfo, Transcript, Word
from .reframe import ReframePlan, plan_reframe
from .render import render_clip, thumbnail
from .report import build_report
from .transcribe import transcribe
from .translate import translate_clip

log = logging.getLogger(__name__)
T = TypeVar("T")

SCHEMA_VERSION = 2


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
                clips.append({"clip_id": f"{media.video_id}_{cfg.output_hash()[:6]}_{i:02d}", "idx": i, "start": c.start, "end": c.end,
                              "duration": round(c.end - c.start, 3), **c.model_dump(exclude={"start", "end"})})
            db.replace_clips(job_id, clips)

        out_dir = Path(cfg.output_dir) / media.video_id
        _step(db, job_id, "render", lambda: _render_all(db, job_id, media, tr, clips, cfg, llm, out_dir, work))
        report = _step(db, job_id, "export", lambda: _export(db, job_id, media, tr, clips, cfg, llm, out_dir, work))
        db.set_job_status(job_id, "done")
        return report
    except BaseException as e:
        if job_id:
            db.set_job_status(job_id, "failed", f"{type(e).__name__}: {e}")
        raise
    finally:
        db.close()


def _layout(cfg: Config) -> tuple[int, Optional[int]]:
    """(main video height, gameplay height or None)."""
    H = cfg.render.height
    if not cfg.gameplay.path:
        return H, None
    top = int(H * cfg.gameplay.top_ratio) // 2 * 2
    return top, H - top


def _caption_margin(cfg: Config, plan: ReframePlan, main_h: int) -> Optional[int]:
    """Captions sit on the seam for stacked layouts (split / gameplay), in the safe zone otherwise."""
    seam = main_h if cfg.gameplay.path else (plan.panels[0].out_h if plan.layout == "split" else None)
    if seam is None:
        return None
    return max(0, cfg.render.height - seam - cfg.captions.font_size // 2)


def _render_all(db: DB, job_id: str, media: MediaInfo, tr: Transcript, clips: list[dict], cfg: Config,
                llm: LLMProvider, out_dir: Path, work: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    _remove_orphans(out_dir, len(clips))
    words = tr.words()
    status = {r["id"]: r["status"] for r in db.get_clips(job_id)}
    # output/<video_id>/ is shared by every config of the same video: the last run owns it
    marker = out_dir / ".clipforge.json"
    owner = read_json(marker) or {}
    if owner.get("job_id") != job_id:
        status = {}  # files on disk belong to another job -> re-render
        write_json(marker, {"job_id": job_id, "config_hash": cfg.output_hash()})
    main_h, game_h = _layout(cfg)
    fps = min(media.fps or 30.0, 30.0)
    W = cfg.render.width
    for c in clips:
        name = f"clip_{c['idx']:02d}"
        mp4 = out_dir / f"{name}.mp4"
        ass = out_dir / f"{name}.ass"
        state_file = _state_path(work, c, cfg)
        if status.get(c["clip_id"]) in ("rendered", "exported") and mp4.exists() and state_file.exists():
            log.info("Clip cached: %s", mp4.name)
            continue
        for stale in out_dir.glob(f"{name}.*"):  # files from another config/selection
            stale.unlink(missing_ok=True)
        try:
            state: dict = {"translations": {}}
            plan_file = work / "reframe" / f"{c['clip_id']}.{text_hash(c['start'], c['end'], cfg.output_hash())}.json"
            cached = read_json(plan_file)
            if cached:
                plan = ReframePlan.from_dict(cached)
            else:
                log.info("Reframing %s (%s)", name, cfg.mode)
                plan = plan_reframe(Path(media.path), media.width, media.height, c["start"], c["end"], cfg,
                                    W, main_h, fps, allow_split=game_h is None)
                write_json(plan_file, plan.to_dict())
            state["reframe"] = {"layout": plan.layout, **plan.info}
            gameplay = pick_gameplay(cfg.gameplay.path, c["clip_id"], c["duration"], game_h) if game_h else None
            margin = _caption_margin(cfg, plan, main_h)
            burn = cfg.captions.style != "none" or cfg.captions.hook

            def render_variant(v_words, hook, suffix=""):
                v_ass = out_dir / f"{name}{suffix}.ass"
                v_mp4 = out_dir / f"{name}{suffix}.mp4"
                atomic_write_text(v_ass, build_ass(v_words, c["duration"], cfg.captions, hook_title=hook, width=W,
                                                   height=cfg.render.height, margin_v=margin))
                render_clip(Path(media.path), c["start"], c["end"], plan, v_ass if burn else None, v_mp4, cfg,
                            gameplay)

            render_variant(clip_words(words, c["start"], c["end"]), c["hook_title"])
            thumbnail(mp4, out_dir / f"{name}.jpg", at=min(1.5, c["duration"] / 2))
            if cfg.translate:
                t_file = work / "translations" / f"{c['clip_id']}.{cfg.translate}.{text_hash(c, repr(llm))}.json"
                t = read_json(t_file)
                if t is None:
                    t_words, t_meta = translate_clip(llm, clip_words(words, c["start"], c["end"]), c, cfg.translate,
                                                     cfg.llm.max_retries)
                    t = {"words": [w.model_dump() for w in t_words], "meta": t_meta}
                    write_json(t_file, t)
                sfx = f".{cfg.translate}"
                render_variant([Word(**w) for w in t["words"]], t["meta"]["hook_title"], sfx)
                state["translations"][cfg.translate] = {
                    **t["meta"], "files": {"video": f"{name}{sfx}.mp4", "subtitles": f"{name}{sfx}.ass"}}
            write_json(state_file, state)
            db.update_clip(c["clip_id"], status="rendered", mp4_path=str(mp4), error=None)
        except Exception as e:
            db.update_clip(c["clip_id"], status="failed", error=f"{type(e).__name__}: {e}")
            log.error("Clip %s failed: %s", name, e)
    failed = [r for r in db.get_clips(job_id) if r["status"] == "failed"]
    if failed and len(failed) == len(clips):
        raise RuntimeError(f"All {len(clips)} clips failed to render; see errors above")


def _state_path(work: Path, c: dict, cfg: Config) -> Path:
    return work / "render" / f"{c['clip_id']}.{text_hash(c['start'], c['end'], cfg.output_hash())}.json"


def _remove_orphans(out_dir: Path, n: int) -> None:
    """Drop clip_XX.* left by a previous run that produced more clips."""
    for f in out_dir.glob("clip_*.*"):
        stem = f.name.split(".")[0]
        if stem[5:].isdigit() and int(stem[5:]) > n:
            f.unlink(missing_ok=True)


def _export(db: DB, job_id: str, media: MediaInfo, tr: Transcript, clips: list[dict], cfg: Config,
            llm: LLMProvider, out_dir: Path, work: Path) -> Path:
    status = {r["id"]: r["status"] for r in db.get_clips(job_id)}
    exported = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for c in clips:
        if status.get(c["clip_id"]) == "failed":
            continue
        name = f"clip_{c['idx']:02d}"
        state = read_json(_state_path(work, c, cfg)) or {}
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
            "translations": state.get("translations", {}),
            "files": {"video": f"{name}.mp4", "subtitles": f"{name}.ass", "thumbnail": f"{name}.jpg"},
            "render": {"w": cfg.render.width, "h": cfg.render.height, "reframe": state.get("reframe", {"mode": cfg.mode}),
                       "gameplay": bool(cfg.gameplay.path), "style": cfg.captions.style, "crf": cfg.render.crf,
                       "lufs": cfg.render.lufs},
            "llm": {"provider": llm.name, "model": llm.model},
            "created_at": now,
        }
        path = out_dir / f"{name}.json"
        write_json(path, meta)
        db.update_clip(c["clip_id"], status="exported", json_path=str(path))
        exported.append(meta)
    exported.sort(key=lambda m: -m["score"])
    return build_report(out_dir, media.title, media.source, exported)
