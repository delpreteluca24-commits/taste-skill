"""Subtitle + metadata translation with the same LLM, keeping the original timing.

Sentences (not 3-word caption groups) are translated for context; each translated sentence keeps its
original [start, end] and its words get timestamps spread proportionally to their length, so karaoke
highlighting still works in the target language.
"""
from __future__ import annotations

import logging
import re

from pydantic import BaseModel, ValidationError

from .highlights import LANG_NAMES, extract_json
from .llm.base import LLMProvider
from .models import Word, normalize_hashtags

log = logging.getLogger(__name__)

SYSTEM = """You translate short-form video subtitles into {lang_name}.
Keep meaning, tone and slang natural for {lang_name} social media. Keep each line about as long as the original.
Answer ONLY with JSON: {{"lines": [{{"i": int, "text": str}}], "hook_title": str, "title": str,
"description": str, "hashtags": [str]}}. Return every line index exactly once."""

USER = """LINES:
{lines}

METADATA:
hook_title: {hook_title}
title: {title}
description: {description}
hashtags: {hashtags}"""


class Line(BaseModel):
    i: int
    text: str


class TranslationResponse(BaseModel):
    lines: list[Line]
    hook_title: str
    title: str
    description: str = ""
    hashtags: list[str] = []


def sentences(words: list[Word], max_gap: float = 0.8) -> list[list[Word]]:
    out: list[list[Word]] = []
    cur: list[Word] = []
    for w in words:
        if cur and (w.start - cur[-1].end > max_gap):
            out.append(cur)
            cur = []
        cur.append(w)
        if re.search(r"[.!?…]$", w.text.strip()):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def spread_words(text: str, start: float, end: float) -> list[Word]:
    """Timestamps for translated words, proportional to character length."""
    toks = text.split()
    if not toks:
        return []
    weights = [len(t) + 1 for t in toks]
    total = sum(weights)
    out, t = [], start
    for tok, wgt in zip(toks, weights):
        d = (end - start) * wgt / total
        out.append(Word(start=round(t, 3), end=round(t + d * 0.92, 3), text=tok))
        t += d
    return out


def translate_clip(llm: LLMProvider, words: list[Word], meta: dict, target: str,
                   max_retries: int = 2) -> tuple[list[Word], dict]:
    """Returns (translated pseudo-words relative to clip start, translated metadata)."""
    sents = sentences(words)
    lines = [" ".join(w.text for w in s) for s in sents]
    lang_name = LANG_NAMES.get(target, target)
    user = USER.format(lines="\n".join(f"[{i}] {l}" for i, l in enumerate(lines)),
                       hook_title=meta["hook_title"], title=meta["title"], description=meta["description"],
                       hashtags=" ".join(meta["hashtags"]))
    err = ""
    for attempt in range(max_retries + 1):
        prompt = user if not err else f"{user}\n\nYour previous answer was invalid: {err}\nReturn corrected JSON."
        raw = llm.complete_json(SYSTEM.format(lang_name=lang_name), prompt, TranslationResponse.model_json_schema())
        try:
            resp = TranslationResponse.model_validate(extract_json(raw))
        except (ValueError, ValidationError) as e:
            err = str(e)[:400]
            log.warning("Translation output invalid (attempt %d): %s", attempt + 1, err)
            continue
        by_i = {l.i: l.text.strip() for l in resp.lines if l.text.strip()}
        missing = [i for i in range(len(lines)) if i not in by_i]
        if missing and attempt < max_retries:
            err = f"missing line indices {missing[:10]}"
            continue
        if missing:
            log.warning("Translation missing %d/%d lines; keeping originals for those", len(missing), len(lines))
        out_words: list[Word] = []
        for i, s in enumerate(sents):
            out_words += spread_words(by_i.get(i, lines[i]), s[0].start, s[-1].end)
        tags = normalize_hashtags(resp.hashtags)
        return out_words, {"hook_title": resp.hook_title.strip(), "title": resp.title.strip(),
                           "description": resp.description.strip(), "hashtags": tags}
    raise RuntimeError(f"Translation to {target} failed after {max_retries + 1} attempts: {err}")
