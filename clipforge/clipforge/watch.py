"""`clipforge watch`: poll a YouTube channel's RSS feed and clip every new upload.

The RSS feed is free and needs no API key/quota. State lives in SQLite (channels, seen_videos), so the
watcher can be stopped and restarted without re-clipping old videos.
"""
from __future__ import annotations

import logging
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable, Optional

import httpx

from .db import DB

log = logging.getLogger(__name__)

RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


class WatchError(RuntimeError):
    pass


@dataclass
class FeedEntry:
    video_id: str
    title: str
    url: str
    published: str

    @property
    def is_short(self) -> bool:
        return "/shorts/" in self.url


def parse_feed(xml_text: str) -> list[FeedEntry]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise WatchError(f"Invalid RSS feed: {e}") from e
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", default="", namespaces=NS)
        link = e.find("a:link", NS)
        url = link.get("href") if link is not None else f"https://www.youtube.com/watch?v={vid}"
        out.append(FeedEntry(vid, e.findtext("a:title", default="", namespaces=NS), url,
                             e.findtext("a:published", default="", namespaces=NS)))
    return sorted(out, key=lambda x: x.published)  # oldest first


def resolve_channel(url: str) -> tuple[str, Optional[str]]:
    """Channel URL (/channel/UC..., /@handle, /c/name) -> (channel_id, title)."""
    m = re.search(r"/channel/(UC[\w-]{22})", url)
    if m:
        return m.group(1), None
    try:
        import yt_dlp

        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": True, "playlistend": 1}) as y:
            info = y.extract_info(url, download=False)
    except Exception as e:
        raise WatchError(f"Cannot resolve channel {url}: {e}") from e
    cid = info.get("channel_id") or (info.get("id") if str(info.get("id", "")).startswith("UC") else None)
    if not cid:
        raise WatchError(f"No channel id found for {url}")
    return cid, info.get("channel") or info.get("title")


def fetch_feed(channel_id: str) -> str:
    try:
        r = httpx.get(RSS_URL.format(channel_id), timeout=30, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise WatchError(f"RSS fetch failed for {channel_id}: {e}") from e
    return r.text


def poll_once(db: DB, channel_id: str, run_fn: Callable[[str], object], max_attempts: int,
              fetch: Callable[[str], str] = fetch_feed) -> list[str]:
    """Clip new uploads once. Returns video ids processed successfully."""
    done = []
    for e in parse_feed(fetch(channel_id)):
        row = db.video_row(channel_id, e.video_id)
        if row and (row["status"] in ("seen", "done", "skipped") or row["attempts"] >= max_attempts):
            continue
        if e.is_short:
            db.set_video(channel_id, e.video_id, "skipped", error="already a short")
            continue
        log.info("New upload: %s (%s)", e.title, e.url)
        db.set_video(channel_id, e.video_id, "queued")
        try:
            report = run_fn(e.url)
        except Exception as ex:  # live/upcoming/premiere or transient: retried on the next poll
            db.set_video(channel_id, e.video_id, "failed", error=f"{type(ex).__name__}: {ex}", bump=True)
            log.error("Clipping %s failed: %s", e.video_id, ex)
            continue
        db.set_video(channel_id, e.video_id, "done", job_report=str(report), bump=True)
        done.append(e.video_id)
    db.touch_channel(channel_id)
    return done


def watch(channel_url: str, cfg, run_fn: Callable[[str], object], backfill: int = 0, once: bool = False,
          fetch: Callable[[str], str] = fetch_feed, sleep: Callable[[float], None] = time.sleep) -> None:
    db = DB(cfg.database)
    try:
        channel_id, title = resolve_channel(channel_url)
        if db.upsert_channel(channel_id, channel_url, title):
            # First time: existing uploads are history, except the newest `backfill` ones
            entries = parse_feed(fetch(channel_id))
            keep = {e.video_id for e in entries[-backfill:]} if backfill else set()
            for e in entries:
                if e.video_id not in keep:
                    db.set_video(channel_id, e.video_id, "seen")
            log.info("Watching %s (%s): %d existing uploads ignored, %d backfilled",
                     title or channel_id, channel_id, len(entries) - len(keep), len(keep))
        while True:
            try:
                n = poll_once(db, channel_id, run_fn, cfg.watch.max_attempts, fetch)
                log.info("Poll done: %d new video(s) clipped", len(n))
            except WatchError as e:
                log.warning("%s (will retry)", e)
            if once:
                return
            sleep(cfg.watch.interval_min * 60)
    finally:
        db.close()
