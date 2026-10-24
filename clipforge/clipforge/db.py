"""SQLite state: jobs/steps/clips (resume after crash), watched channels, publications, API quota."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  media_hash  TEXT,
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (video_id, config_hash)
);
CREATE TABLE IF NOT EXISTS steps (
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step        TEXT NOT NULL CHECK (step IN ('ingest','transcribe','select','render','export')),
  status      TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  input_hash  TEXT,
  output_path TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  PRIMARY KEY (job_id, step)
);
CREATE TABLE IF NOT EXISTS clips (
  id        TEXT PRIMARY KEY,
  job_id    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  start_s   REAL NOT NULL,
  end_s     REAL NOT NULL,
  score     INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  status    TEXT NOT NULL CHECK (status IN ('selected','rendered','exported','failed','published')),
  data_json TEXT NOT NULL,
  json_path TEXT,
  mp4_path  TEXT,
  error     TEXT,
  UNIQUE (job_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_clips_job ON clips(job_id, status);
CREATE TABLE IF NOT EXISTS channels (
  channel_id      TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  title           TEXT,
  last_checked_at TEXT
);
CREATE TABLE IF NOT EXISTS seen_videos (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('seen','queued','done','failed','skipped')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  job_report TEXT,
  error      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, video_id)
);
CREATE TABLE IF NOT EXISTS publications (
  clip_id      TEXT NOT NULL,
  platform     TEXT NOT NULL,
  variant      TEXT NOT NULL DEFAULT '',   -- '' = original, else translation language
  remote_id    TEXT,
  status       TEXT NOT NULL CHECK (status IN ('uploading','done','failed')),
  quota_cost   INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  published_at TEXT,
  PRIMARY KEY (clip_id, platform, variant)
);
CREATE TABLE IF NOT EXISTS quota_usage (
  day      TEXT NOT NULL,                  -- quota day in the platform's timezone
  platform TEXT NOT NULL,
  units    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform)
);
"""


class DB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, isolation_level=None, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield self.conn
            self.conn.execute("COMMIT")
        except BaseException:
            self.conn.execute("ROLLBACK")
            raise

    # --- jobs ---------------------------------------------------------------
    def get_or_create_job(
        self, source: str, video_id: str, config: dict, config_hash: str, media_hash: Optional[str] = None
    ) -> sqlite3.Row:
        with self.tx() as c:
            row = c.execute(
                "SELECT * FROM jobs WHERE video_id=? AND config_hash=?", (video_id, config_hash)
            ).fetchone()
            if row is None:
                job_id = uuid.uuid4().hex
                c.execute(
                    "INSERT INTO jobs(id, source, video_id, media_hash, config_json, config_hash, status)"
                    " VALUES (?,?,?,?,?,?, 'pending')",
                    (job_id, source, video_id, media_hash, json.dumps(config), config_hash),
                )
                row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return row

    def get_job(self, job_id: str) -> Optional[sqlite3.Row]:
        rows = self.conn.execute("SELECT * FROM jobs WHERE id LIKE ?", (f"{job_id}%",)).fetchall()
        if len(rows) > 1:
            raise ValueError(f"Ambiguous job id prefix: {job_id}")
        return rows[0] if rows else None

    def list_jobs(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT j.*, (SELECT COUNT(*) FROM clips c WHERE c.job_id=j.id) AS n_clips"
            " FROM jobs j ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    def set_job_status(self, job_id: str, status: str, error: Optional[str] = None) -> None:
        self.conn.execute(
            "UPDATE jobs SET status=?, error=?, updated_at=datetime('now') WHERE id=?",
            (status, error, job_id),
        )

    # --- steps --------------------------------------------------------------
    def step_done(self, job_id: str, step: str, input_hash: Optional[str] = None) -> bool:
        row = self.conn.execute(
            "SELECT status, input_hash FROM steps WHERE job_id=? AND step=?", (job_id, step)
        ).fetchone()
        return bool(row and row["status"] == "done" and (input_hash is None or row["input_hash"] == input_hash))

    def start_step(self, job_id: str, step: str, input_hash: Optional[str] = None) -> None:
        self.conn.execute(
            "INSERT INTO steps(job_id, step, status, input_hash, attempts, started_at)"
            " VALUES (?,?, 'running', ?, 1, datetime('now'))"
            " ON CONFLICT(job_id, step) DO UPDATE SET status='running', input_hash=excluded.input_hash,"
            " attempts=attempts+1, error=NULL, started_at=datetime('now'), finished_at=NULL",
            (job_id, step, input_hash),
        )

    def finish_step(self, job_id: str, step: str, output_path: Optional[str] = None) -> None:
        self.conn.execute(
            "UPDATE steps SET status='done', output_path=?, finished_at=datetime('now') WHERE job_id=? AND step=?",
            (output_path, job_id, step),
        )

    def fail_step(self, job_id: str, step: str, error: str) -> None:
        self.conn.execute(
            "UPDATE steps SET status='failed', error=?, finished_at=datetime('now') WHERE job_id=? AND step=?",
            (error, job_id, step),
        )

    def get_steps(self, job_id: str) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM steps WHERE job_id=? ORDER BY started_at", (job_id,)).fetchall()

    # --- clips --------------------------------------------------------------
    def replace_clips(self, job_id: str, clips: list[dict]) -> None:
        """Store a fresh selection. Each dict: idx, start, end, score + metadata."""
        with self.tx() as c:
            c.execute("DELETE FROM clips WHERE job_id=?", (job_id,))
            for cl in clips:
                c.execute(
                    "INSERT INTO clips(id, job_id, idx, start_s, end_s, score, status, data_json)"
                    " VALUES (?,?,?,?,?,?, 'selected', ?)",
                    (cl["clip_id"], job_id, cl["idx"], cl["start"], cl["end"], cl["score"], json.dumps(cl)),
                )

    def get_clips(self, job_id: str) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM clips WHERE job_id=? ORDER BY idx", (job_id,)).fetchall()

    def update_clip(self, clip_id: str, **fields) -> None:
        allowed = {"status", "json_path", "mp4_path", "error"}
        bad = set(fields) - allowed
        if bad:
            raise ValueError(f"Cannot update clip fields: {bad}")
        sets = ", ".join(f"{k}=?" for k in fields)
        self.conn.execute(f"UPDATE clips SET {sets} WHERE id=?", (*fields.values(), clip_id))

    # --- watch --------------------------------------------------------------
    def upsert_channel(self, channel_id: str, url: str, title: Optional[str]) -> bool:
        """Returns True if the channel is new."""
        new = self.conn.execute("SELECT 1 FROM channels WHERE channel_id=?", (channel_id,)).fetchone() is None
        self.conn.execute(
            "INSERT INTO channels(channel_id, url, title) VALUES (?,?,?)"
            " ON CONFLICT(channel_id) DO UPDATE SET url=excluded.url, title=COALESCE(excluded.title, title)",
            (channel_id, url, title),
        )
        return new

    def touch_channel(self, channel_id: str) -> None:
        self.conn.execute("UPDATE channels SET last_checked_at=datetime('now') WHERE channel_id=?", (channel_id,))

    def video_row(self, channel_id: str, video_id: str) -> Optional[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM seen_videos WHERE channel_id=? AND video_id=?", (channel_id, video_id)
        ).fetchone()

    def set_video(self, channel_id: str, video_id: str, status: str, error: Optional[str] = None,
                  job_report: Optional[str] = None, bump: bool = False) -> None:
        self.conn.execute(
            "INSERT INTO seen_videos(channel_id, video_id, status, attempts, error, job_report)"
            " VALUES (?,?,?,?,?,?) ON CONFLICT(channel_id, video_id) DO UPDATE SET status=excluded.status,"
            " attempts=attempts+?, error=excluded.error, job_report=COALESCE(excluded.job_report, job_report),"
            " updated_at=datetime('now')",
            (channel_id, video_id, status, int(bump), error, job_report, int(bump)),
        )

    # --- publish ------------------------------------------------------------
    def get_publication(self, clip_id: str, platform: str, variant: str = "") -> Optional[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM publications WHERE clip_id=? AND platform=? AND variant=?", (clip_id, platform, variant)
        ).fetchone()

    def set_publication(self, clip_id: str, platform: str, variant: str, status: str, remote_id: Optional[str] = None,
                        quota_cost: int = 0, error: Optional[str] = None) -> None:
        self.conn.execute(
            "INSERT INTO publications(clip_id, platform, variant, status, remote_id, quota_cost, error, published_at)"
            " VALUES (?,?,?,?,?,?,?, CASE WHEN ?='done' THEN datetime('now') END)"
            " ON CONFLICT(clip_id, platform, variant) DO UPDATE SET status=excluded.status,"
            " remote_id=COALESCE(excluded.remote_id, remote_id), quota_cost=quota_cost+excluded.quota_cost,"
            " error=excluded.error, published_at=COALESCE(excluded.published_at, published_at)",
            (clip_id, platform, variant, status, remote_id, quota_cost, error, status),
        )

    def quota_used(self, day: str, platform: str) -> int:
        row = self.conn.execute("SELECT units FROM quota_usage WHERE day=? AND platform=?", (day, platform)).fetchone()
        return row["units"] if row else 0

    def add_quota(self, day: str, platform: str, units: int) -> None:
        self.conn.execute(
            "INSERT INTO quota_usage(day, platform, units) VALUES (?,?,?)"
            " ON CONFLICT(day, platform) DO UPDATE SET units=units+excluded.units",
            (day, platform, units),
        )
