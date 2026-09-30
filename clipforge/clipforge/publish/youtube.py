"""`clipforge publish youtube <clip.json>`: upload a clip as a YouTube Short (Data API v3, OAuth).

Quota: the default project quota is 10,000 units/day and one upload costs `publish.upload_cost` units
(1600 by default), i.e. ~6 uploads/day. Usage is tracked in SQLite per Pacific-time day (when Google resets it).
Note: API projects that have not passed Google's audit can only upload PRIVATE videos.
"""
from __future__ import annotations

import json
import logging
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from ..db import DB

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
PLATFORM = "youtube"
RETRY_STATUS = {500, 502, 503, 504}


class PublishError(RuntimeError):
    pass


class QuotaError(PublishError):
    pass


def quota_day(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(ZoneInfo("UTC"))
    return now.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()


def _clean(text: str) -> str:
    return text.replace("<", "").replace(">", "").strip()


def build_body(meta: dict, cfg, variant: str = "") -> dict:
    """Snippet/status for videos.insert, within YouTube limits (title 100, description 5000, tags 500 chars)."""
    src = meta["translations"][variant] if variant else meta
    tags_h = list(dict.fromkeys(src.get("hashtags", []) + ["#Shorts"]))
    title = _clean(src["title"])[:100] or "Short"
    desc = _clean(f"{src.get('description', '')}\n\n{' '.join(tags_h)}")[:5000]
    tags, total = [], 0
    for t in (h.lstrip("#") for h in tags_h):
        if total + len(t) + 1 > 500:
            break
        tags.append(t)
        total += len(t) + 1
    body: dict[str, Any] = {
        "snippet": {"title": title, "description": desc, "tags": tags, "categoryId": cfg.publish.category_id},
        "status": {"privacyStatus": cfg.publish.privacy, "selfDeclaredMadeForKids": False},
    }
    lang = variant or meta.get("language")
    if lang:
        body["snippet"]["defaultLanguage"] = lang
        body["snippet"]["defaultAudioLanguage"] = meta.get("language") or lang
    return body


def get_service(cfg):  # pragma: no cover - needs a browser + Google account
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as e:
        raise PublishError('Install publish extras: pip install "clipforge[publish]"') from e
    token = Path(cfg.cache_dir) / "youtube_token.json"
    creds = Credentials.from_authorized_user_file(str(token), SCOPES) if token.exists() else None
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        secret = Path(cfg.publish.client_secret)
        if not secret.exists():
            raise PublishError(
                f"OAuth client file not found: {secret}. Create a 'Desktop app' OAuth client in Google Cloud "
                "Console (YouTube Data API v3 enabled) and download it as client_secret.json."
            )
        creds = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES).run_local_server(port=0)
        token.parent.mkdir(parents=True, exist_ok=True)
        token.write_text(creds.to_json(), encoding="utf-8")
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def _media(path: Path):  # pragma: no cover - thin wrapper
    from googleapiclient.http import MediaFileUpload

    return MediaFileUpload(str(path), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)


def _upload(request, max_retries: int = 5, sleep=time.sleep) -> dict:
    """Resumable upload loop with exponential backoff on 5xx/network errors."""
    response, attempt = None, 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                log.info("Upload %d%%", int(status.progress() * 100))
        except Exception as e:
            code = getattr(getattr(e, "resp", None), "status", None)
            if (code in RETRY_STATUS or code is None) and attempt < max_retries:
                attempt += 1
                wait = min(60, 2 ** attempt + random.random())
                log.warning("Upload error (%s), retry %d/%d in %.0fs", code or e, attempt, max_retries, wait)
                sleep(wait)
                continue
            raise PublishError(f"Upload failed: {e}") from e
    return response


def publish(clip_json: Path, cfg, variant: str = "", dry_run: bool = False, service=None, media_factory=_media,
            sleep=time.sleep) -> Optional[str]:
    """Upload one clip (or its translated `variant`). Idempotent: an already published clip is skipped."""
    clip_json = Path(clip_json)
    meta = json.loads(clip_json.read_text(encoding="utf-8"))
    if variant and variant not in meta.get("translations", {}):
        raise PublishError(f"No '{variant}' translation in {clip_json.name}")
    files = meta["translations"][variant]["files"] if variant else meta["files"]
    video = clip_json.parent / files["video"]
    if not video.exists():
        raise PublishError(f"Video not found: {video}")
    body = build_body(meta, cfg, variant)
    if dry_run:
        log.info("Dry run, would upload %s with:\n%s", video.name, json.dumps(body, ensure_ascii=False, indent=2))
        return None

    db = DB(cfg.database)
    try:
        prev = db.get_publication(meta["clip_id"], PLATFORM, variant)
        if prev and prev["status"] == "done":
            log.info("Already published: https://youtube.com/shorts/%s", prev["remote_id"])
            return prev["remote_id"]
        day, cost = quota_day(), cfg.publish.upload_cost
        used = db.quota_used(day, PLATFORM)
        if used + cost > cfg.publish.daily_quota:
            raise QuotaError(f"Daily YouTube quota reached ({used}/{cfg.publish.daily_quota} units on {day}, "
                             "Pacific time). It resets at midnight PT.")
        service = service or get_service(cfg)
        db.set_publication(meta["clip_id"], PLATFORM, variant, "uploading")
        request = service.videos().insert(part="snippet,status", body=body, media_body=media_factory(video))
        try:
            response = _upload(request, sleep=sleep)
        except Exception as e:
            # a failed insert may still have consumed quota: count it conservatively
            db.add_quota(day, PLATFORM, cost)
            db.set_publication(meta["clip_id"], PLATFORM, variant, "failed", quota_cost=cost, error=str(e))
            raise
        db.add_quota(day, PLATFORM, cost)
        vid = response["id"]
        db.set_publication(meta["clip_id"], PLATFORM, variant, "done", remote_id=vid, quota_cost=cost)
        log.info("Published: https://youtube.com/shorts/%s (%s)", vid, cfg.publish.privacy)
        return vid
    finally:
        db.close()
