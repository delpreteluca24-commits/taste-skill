"""Step 5 — snap clip boundaries to word/silence edges; strong start, end on a full sentence."""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from typing import Optional

from .models import Word

FILLERS = {
    "it": {"allora", "ehm", "eh", "ehh", "uhm", "mh", "mmh", "cioè", "dunque", "quindi", "insomma",
           "praticamente", "vabbè", "vabbe", "beh", "be'", "mah", "ok", "okay", "e", "ma", "però", "comunque"},
    "en": {"so", "um", "uh", "uhm", "er", "like", "well", "okay", "ok", "yeah", "basically", "actually",
           "anyway", "and", "but", "right"},
    "es": {"entonces", "bueno", "pues", "eh", "este", "y", "pero", "vale"},
    "fr": {"alors", "euh", "bon", "bah", "donc", "enfin", "et", "mais", "voilà"},
    "de": {"also", "äh", "ähm", "halt", "und", "aber", "naja", "so"},
}
_SENT_END = re.compile(r"[.!?…]+[\"'»”)]*$")
_CLAUSE_END = re.compile(r"[,;:]$")


def norm(text: str) -> str:
    return re.sub(r"[^\w']", "", text.lower(), flags=re.UNICODE)


def is_filler(word: Word, lang: str) -> bool:
    return norm(word.text) in FILLERS.get((lang or "en")[:2], FILLERS["en"])


def ends_sentence(word: Word) -> bool:
    return _SENT_END.search(word.text.strip()) is not None


@dataclass
class Snapped:
    start: float
    end: float
    first: int  # index of first word
    last: int  # index of last word (inclusive)


def snap(
    words: list[Word],
    start: float,
    end: float,
    lang: str,
    min_s: float,
    max_s: float,
    pad_before: float = 0.12,
    pad_after: float = 0.35,
    tolerance: float = 0.3,
) -> Optional[Snapped]:
    """Return snapped boundaries, or None if no valid clip fits [min_s, max_s]."""
    if not words:
        return None
    starts = [w.start for w in words]

    # 1. First word at/after start; skip leading fillers ("allora", "ehm", "so", ...)
    first = bisect.bisect_left(starts, start - tolerance)
    while first < len(words) and is_filler(words[first], lang):
        first += 1
    if first >= len(words):
        return None
    t0 = words[first].start

    # 2. Last word that ends by `end` (+tolerance)
    last = bisect.bisect_right(starts, end + tolerance) - 1
    while last > first and words[last].end > end + tolerance:
        last -= 1
    if last < first:
        return None

    def dur(i: int) -> float:
        return words[i].end - t0

    # 3. Too long -> cut back under max_s
    while last > first and dur(last) > max_s:
        last -= 1

    # 4. Prefer ending on a sentence end: search backward, but stay >= min_s
    if not ends_sentence(words[last]):
        back = next((i for i in range(last, first - 1, -1) if ends_sentence(words[i]) and dur(i) >= min_s), None)
        if back is not None:
            last = back
        else:
            # 5. Else extend forward to the next sentence end within max_s (also fixes too-short clips)
            fwd = next((i for i in range(last + 1, len(words)) if dur(i) > max_s or ends_sentence(words[i])), None)
            if fwd is not None and dur(fwd) <= max_s and ends_sentence(words[fwd]):
                last = fwd
            elif dur(last) < min_s:
                # Extend to the longest clause/any word that stays within max_s
                i = last
                while i + 1 < len(words) and dur(i + 1) <= max_s and dur(i) < min_s:
                    i += 1
                last = i

    # 6. Drop trailing fillers ("..., quindi")
    while last > first and is_filler(words[last], lang) and dur(last - 1) >= min_s:
        last -= 1

    if dur(last) < min_s or dur(last) > max_s:
        return None

    # 7. Pad into the surrounding silence without eating neighbouring words
    prev_end = words[first - 1].end if first > 0 else 0.0
    next_start = words[last + 1].start if last + 1 < len(words) else words[last].end + pad_after
    s = max(prev_end + (t0 - prev_end) / 2 if t0 - prev_end < 2 * pad_before else t0 - pad_before, 0.0)
    e_word = words[last].end
    e = min(e_word + pad_after, next_start - 0.02) if next_start > e_word else e_word
    return Snapped(start=round(s, 3), end=round(max(e, e_word), 3), first=first, last=last)
