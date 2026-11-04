"""Step 4 — ask the LLM for viral moments (as segment ids), validate, snap, dedupe, rank."""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

from pydantic import ValidationError

from .cache import read_json, text_hash, write_json
from .chunking import render_window, windows
from .llm.base import LLMError, LLMProvider
from .models import ClipCandidate, LLMClip, LLMResponse, Segment, Transcript
from .snap import snap

log = logging.getLogger(__name__)

LANG_NAMES = {"it": "Italian", "en": "English", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese"}

SYSTEM = """You are a senior short-form video editor (TikTok, YouTube Shorts, Reels).
You receive a transcript split in numbered segments: `[id] (timestamp, duration) text`.
Pick the moments most likely to go viral as standalone vertical clips.

Rules:
- Each clip is SELF-CONTAINED: a viewer with no context understands it and gets a payoff.
- Strong opening: the first segment must hook immediately (claim, question, conflict, surprise).
  Never start on filler ("so", "um", "allora", "ehm", "quindi") or mid-thought.
- End on a complete sentence, after the payoff or punchline.
- Clip length between {min_s:.0f} and {max_s:.0f} seconds (sum the segment durations).
- Clips must NOT overlap each other.
- score 0-100 = realistic viral potential; be strict, most moments are 40-70.
- Answer ONLY with JSON: {{"clips": [{{"start_seg": int, "end_seg": int, "score": int,
  "hook_title": str, "reason": str, "title": str, "description": str, "hashtags": [str]}}]}}
- start_seg/end_seg are segment ids from the transcript (inclusive).
- hook_title: max 8 words, punchy on-screen text for the first 3 seconds.
- title: max 70 chars. description: 1-2 sentences. hashtags: 3-6, no spaces.
- Write hook_title, title, description, hashtags in {lang_name}."""

USER = """Return up to {n} clips from this transcript window.

TRANSCRIPT:
{transcript}"""


class SelectionError(RuntimeError):
    pass


def extract_json(raw: str) -> object:
    """Parse model output tolerant to code fences and surrounding prose."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        i, j = text.find(open_c), text.rfind(close_c)
        if i != -1 and j > i:
            try:
                return json.loads(text[i : j + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError("no JSON object found in LLM output")


def parse_llm_response(raw: str) -> LLMResponse:
    """Raise ValueError (with a readable message for the retry prompt) on invalid output."""
    data = extract_json(raw)
    if isinstance(data, list):
        data = {"clips": data}
    if isinstance(data, dict) and "clips" not in data and "start_seg" in data:
        data = {"clips": [data]}
    try:
        return LLMResponse.model_validate(data)
    except ValidationError as e:
        # Keep valid items when only some are broken
        if isinstance(data, dict) and isinstance(data.get("clips"), list):
            good = []
            for item in data["clips"]:
                try:
                    good.append(LLMClip.model_validate(item))
                except ValidationError:
                    continue
            if good:
                return LLMResponse(clips=good)
        raise ValueError(f"JSON does not match schema: {e.errors()[:3]}") from e


def ask_window(llm: LLMProvider, win: list[Segment], n: int, lang: str, min_s: float, max_s: float,
               max_retries: int) -> list[LLMClip]:
    system = SYSTEM.format(min_s=min_s, max_s=max_s, lang_name=LANG_NAMES.get(lang, lang))
    user = USER.format(n=n, transcript=render_window(win))
    schema = LLMResponse.model_json_schema()
    ids = {s.id for s in win}
    last_err = ""
    for attempt in range(max_retries + 1):
        prompt = user if not last_err else (
            f"{user}\n\nYour previous answer was invalid: {last_err}\nReturn corrected JSON only."
        )
        raw = llm.complete_json(system, prompt, schema)
        try:
            resp = parse_llm_response(raw)
        except ValueError as e:
            last_err = str(e)[:500]
            log.warning("LLM output invalid (attempt %d/%d): %s", attempt + 1, max_retries + 1, last_err)
            continue
        valid = [c for c in resp.clips if c.start_seg in ids and c.end_seg in ids]
        dropped = len(resp.clips) - len(valid)
        if dropped:
            log.debug("Dropped %d clips with segment ids outside the window", dropped)
        return valid
    log.error("LLM failed %d times on window %d-%d; skipping it", max_retries + 1, win[0].id, win[-1].id)
    return []


def overlap(a: ClipCandidate, b: ClipCandidate) -> float:
    return max(0.0, min(a.end, b.end) - max(a.start, b.start))


def dedupe_rank(cands: list[ClipCandidate], n: int) -> list[ClipCandidate]:
    """Greedy by score: keep a clip only if it does not overlap an already kept one."""
    kept: list[ClipCandidate] = []
    for c in sorted(cands, key=lambda c: (-c.score, c.start)):
        if all(overlap(c, k) <= 0 for k in kept):
            kept.append(c)
        if len(kept) >= n:
            break
    return kept


def to_candidates(tr: Transcript, clips: list[LLMClip], min_s: float, max_s: float) -> list[ClipCandidate]:
    by_id = {s.id: s for s in tr.segments}
    words = tr.words()
    out: list[ClipCandidate] = []
    for c in clips:
        raw_start, raw_end = by_id[c.start_seg].start, by_id[c.end_seg].end
        s = snap(words, raw_start, raw_end, tr.language, min_s, max_s)
        if s is None:
            log.debug("Discarded '%s' (%.1f-%.1f): cannot fit %g-%gs", c.title, raw_start, raw_end, min_s, max_s)
            continue
        out.append(ClipCandidate(start=s.start, end=s.end, **c.model_dump(exclude={"start_seg", "end_seg"})))
    return out


def select_clips(tr: Transcript, llm: LLMProvider, cfg, cache_dir: Optional[Path] = None) -> list[ClipCandidate]:
    lc, cc = cfg.llm, cfg.clips
    lang = cfg.lang or tr.language
    key = text_hash(tr.model_dump(), repr(llm), lc.temperature, lc.window_s, lc.overlap_s,
                    cc.count, cc.min_s, cc.max_s, lang)
    cache_file = Path(cache_dir) / f"highlights.{key}.json" if cache_dir else None
    if cache_file:
        cached = read_json(cache_file)
        if cached is not None:
            log.info("LLM selection cached")
            return [ClipCandidate.model_validate(c) for c in cached]

    wins = windows(tr.segments, lc.window_s, lc.overlap_s)
    per_window = max(2, -(-cc.count * 2 // max(1, len(wins))))  # oversample, then dedupe
    all_clips: list[LLMClip] = []
    errors = 0
    for i, win in enumerate(wins, 1):
        log.info("LLM %s: window %d/%d (segments %d-%d)", llm, i, len(wins), win[0].id, win[-1].id)
        try:
            all_clips += ask_window(llm, win, per_window, lang, cc.min_s, cc.max_s, lc.max_retries)
        except LLMError:
            errors += 1
            if errors == len(wins) or i == 1:
                raise  # provider unreachable / misconfigured: fail loudly instead of 0 clips
            log.exception("LLM call failed on window %d", i)

    result = dedupe_rank(to_candidates(tr, all_clips, cc.min_s, cc.max_s), cc.count)
    if not result:
        raise SelectionError(
            "No valid clips found. Try a larger model, a wider --min/--max range, or check the transcript language."
        )
    if cache_file:
        write_json(cache_file, [c.model_dump() for c in result])
    return result
