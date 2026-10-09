"""Step 7a — .ass subtitles from word timestamps: karaoke captions, hook title, optional CTA."""
from __future__ import annotations

import re
from dataclasses import dataclass
from textwrap import wrap

from .models import Word

GAP_BREAK_S = 0.6  # silence that forces a new caption group
MAX_GROUP_CHARS = 22
MERGE_GAP_S = 0.35  # bridge short gaps so captions don't flicker


def ass_color(hex_rgb: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (ASS is BGR with inverted alpha)."""
    h = hex_rgb.lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        raise ValueError(f"Invalid color: {hex_rgb}")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(t: float) -> str:
    cs = max(0, int(round(t * 100)))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


@dataclass
class Group:
    words: list[Word]

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end


def group_words(words: list[Word], max_words: int) -> list[Group]:
    groups: list[Group] = []
    cur: list[Word] = []
    for w in words:
        if cur:
            gap = w.start - cur[-1].end
            chars = sum(len(x.text) + 1 for x in cur) + len(w.text)
            punct = re.search(r"[.!?,;:…]$", cur[-1].text.strip()) is not None
            if len(cur) >= max_words or gap > GAP_BREAK_S or chars > MAX_GROUP_CHARS or punct:
                groups.append(Group(cur))
                cur = []
        cur.append(w)
    if cur:
        groups.append(Group(cur))
    return groups


def clip_words(words: list[Word], start: float, end: float) -> list[Word]:
    """Words inside [start, end], re-timed relative to the clip start."""
    out = []
    for w in words:
        if w.end <= start or w.start >= end:
            continue
        out.append(Word(start=max(0.0, w.start - start), end=min(end, w.end) - start, text=w.text, prob=w.prob))
    return out


def _header(cfg, width: int, height: int, margin_v: int | None = None) -> str:
    c = cfg
    mv = c.margin_v if margin_v is None else margin_v
    white, hl = ass_color(c.text_color), ass_color(c.highlight_color)
    black, box = ass_color("#000000"), ass_color("#000000", alpha=0x40)
    hook_size = int(c.font_size * 0.95)
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{c.font},{c.font_size},{white},{hl},{black},{black},-1,0,0,0,100,100,0,0,1,{c.outline},2,2,80,80,{mv},1
Style: Hook,{c.font},{hook_size},{black},{white},{white},{box},-1,0,0,0,100,100,0,0,3,18,0,8,90,90,{c.hook_margin_v},1
Style: CTA,{c.font},{hook_size},{black},{white},{white},{box},-1,0,0,0,100,100,0,0,3,18,0,5,90,90,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _dialogue(start: float, end: float, style: str, text: str, layer: int = 0) -> str:
    return f"Dialogue: {layer},{ass_time(start)},{ass_time(end)},{style},,0,0,0,,{text}"


def build_ass(words: list[Word], duration: float, cfg, hook_title: str = "",
              width: int = 1080, height: int = 1920, margin_v: int | None = None) -> str:
    """`words` must already be relative to the clip start (see clip_words).
    `margin_v` overrides the caption position (split/gameplay layouts put captions on the seam)."""
    lines = [_header(cfg, width, height, margin_v)]
    hl = ass_color(cfg.highlight_color)

    def fmt(t: str) -> str:
        return escape(t.upper() if cfg.uppercase else t)

    if cfg.style != "none" and words:
        groups = group_words(words, cfg.max_words)
        for gi, g in enumerate(groups):
            nxt = groups[gi + 1].start if gi + 1 < len(groups) else duration
            g_end = nxt if nxt - g.end <= MERGE_GAP_S else g.end
            g_end = min(g_end, duration)
            if cfg.style == "simple":
                lines.append(_dialogue(g.start, g_end, "Caption", " ".join(fmt(w.text) for w in g.words)))
                continue
            # karaoke: one event per active word, active word coloured + slight pop
            for wi, w in enumerate(g.words):
                w_start = g.start if wi == 0 else w.start
                w_end = g.words[wi + 1].start if wi + 1 < len(g.words) else g_end
                if w_end <= w_start:
                    continue
                parts = []
                for j, x in enumerate(g.words):
                    t = fmt(x.text)
                    parts.append(f"{{\\c{hl}\\fscx108\\fscy108}}{t}{{\\r}}" if j == wi else t)
                lines.append(_dialogue(w_start, w_end, "Caption", " ".join(parts)))

    if cfg.hook and hook_title:
        text = "\\N".join(wrap(escape(hook_title), 20)) or escape(hook_title)
        lines.append(_dialogue(0, min(cfg.hook_duration_s, duration), "Hook", "{\\fad(150,250)}" + text, layer=1))
    if cfg.cta_text and duration > cfg.cta_duration_s + cfg.hook_duration_s:
        text = "\\N".join(wrap(escape(cfg.cta_text), 22))
        lines.append(_dialogue(duration - cfg.cta_duration_s, duration, "CTA", "{\\fad(200,0)}" + text, layer=1))
    return "\n".join(lines) + "\n"
