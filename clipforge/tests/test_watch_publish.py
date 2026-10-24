import json
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

from clipforge.db import DB
from clipforge.publish.youtube import PublishError, QuotaError, _upload, build_body, publish, quota_day
from clipforge.watch import parse_feed, poll_once, resolve_channel, watch

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>new2</yt:videoId><title>Second</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=new2"/><published>2026-09-29T10:00:00+00:00</published></entry>
 <entry><yt:videoId>short1</yt:videoId><title>A short</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/short1"/><published>2026-09-28T10:00:00+00:00</published></entry>
 <entry><yt:videoId>old1</yt:videoId><title>First</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=old1"/><published>2026-09-27T10:00:00+00:00</published></entry>
</feed>"""
CID = "UC" + "x" * 22


def test_parse_feed_oldest_first():
    e = parse_feed(FEED)
    assert [x.video_id for x in e] == ["old1", "short1", "new2"] and e[1].is_short


def test_resolve_channel_id_from_url():
    assert resolve_channel(f"https://www.youtube.com/channel/{CID}") == (CID, None)


def test_poll_once_clips_new_skips_shorts_and_retries(cfg):
    db = DB(cfg.database)
    db.upsert_channel(CID, "u", "t")
    calls = []

    def run_fn(url):
        calls.append(url)
        if url.endswith("new2"):
            raise RuntimeError("live not finished")
        return "report.html"

    assert poll_once(db, CID, run_fn, max_attempts=2, fetch=lambda c: FEED) == ["old1"]
    assert db.video_row(CID, "short1")["status"] == "skipped"
    assert db.video_row(CID, "new2")["status"] == "failed"
    poll_once(db, CID, run_fn, max_attempts=2, fetch=lambda c: FEED)  # retry new2 once more
    poll_once(db, CID, run_fn, max_attempts=2, fetch=lambda c: FEED)  # gave up after 2 attempts
    assert calls.count("https://www.youtube.com/watch?v=new2") == 2 and calls.count(
        "https://www.youtube.com/watch?v=old1") == 1


def test_watch_first_run_ignores_history_except_backfill(cfg):
    seen = []
    watch(f"https://www.youtube.com/channel/{CID}", cfg, lambda u: seen.append(u) or "r", backfill=1, once=True,
          fetch=lambda c: FEED)
    assert seen == ["https://www.youtube.com/watch?v=new2"]
    watch(f"https://www.youtube.com/channel/{CID}", cfg, lambda u: seen.append(u) or "r", once=True,
          fetch=lambda c: FEED)
    assert len(seen) == 1  # nothing new on the second poll


# --- publish ------------------------------------------------------------------

def _clip(tmp_path, **over):
    meta = {"clip_id": "vid_abc_01", "title": "T" * 150, "description": "Desc <b>", "hashtags": ["#a", "#b"],
            "language": "it", "files": {"video": "clip_01.mp4"},
            "translations": {"en": {"title": "EN", "description": "d", "hashtags": ["#en"],
                                    "files": {"video": "clip_01.en.mp4"}}}, **over}
    (tmp_path / "clip_01.mp4").write_bytes(b"v")
    p = tmp_path / "clip_01.json"
    p.write_text(json.dumps(meta))
    return p, meta


def test_build_body_limits(cfg, tmp_path):
    _, meta = _clip(tmp_path)
    b = build_body(meta, cfg)
    assert len(b["snippet"]["title"]) == 100 and "<" not in b["snippet"]["description"]
    assert b["snippet"]["tags"] == ["a", "b", "Shorts"] and "#Shorts" in b["snippet"]["description"]
    assert b["status"]["privacyStatus"] == "private"
    en = build_body(meta, cfg, "en")
    assert en["snippet"]["title"] == "EN" and en["snippet"]["defaultLanguage"] == "en"


def test_quota_day_is_pacific():
    assert quota_day(datetime(2026, 9, 30, 5, 0, tzinfo=timezone.utc)) == "2026-09-29"


class FakeRequest:
    def __init__(self, fail_times=0, code=503):
        self.fail_times, self.code, self.calls = fail_times, code, 0

    def next_chunk(self):
        self.calls += 1
        if self.calls <= self.fail_times:
            err = Exception("server error")
            err.resp = NS(status=self.code)
            raise err
        return None, {"id": "yt123"}


class FakeService:
    def __init__(self, req):
        self.req, self.bodies = req, []

    def videos(self):
        return self

    def insert(self, part, body, media_body):
        self.bodies.append(body)
        return self.req


def test_publish_idempotent_and_counts_quota(cfg, tmp_path):
    p, _ = _clip(tmp_path)
    svc = FakeService(FakeRequest(fail_times=1))
    assert publish(p, cfg, service=svc, media_factory=lambda v: None, sleep=lambda s: None) == "yt123"
    assert publish(p, cfg, service=FakeService(FakeRequest(99)), media_factory=lambda v: None) == "yt123"
    db = DB(cfg.database)
    assert db.quota_used(quota_day(), "youtube") == 1600
    assert db.get_publication("vid_abc_01", "youtube")["status"] == "done"


def test_publish_quota_exceeded(cfg, tmp_path):
    p, _ = _clip(tmp_path)
    db = DB(cfg.database)
    db.add_quota(quota_day(), "youtube", 9000)
    with pytest.raises(QuotaError):
        publish(p, cfg, service=FakeService(FakeRequest()), media_factory=lambda v: None)


def test_publish_missing_variant_and_video(cfg, tmp_path):
    p, _ = _clip(tmp_path)
    with pytest.raises(PublishError):
        publish(p, cfg, variant="fr")
    with pytest.raises(PublishError):
        publish(p, cfg, variant="en")  # clip_01.en.mp4 missing


def test_upload_gives_up_on_4xx():
    with pytest.raises(PublishError):
        _upload(FakeRequest(fail_times=1, code=403), sleep=lambda s: None)
