import re

import pytest

from clipforge.captions import ass_color, ass_time, build_ass, clip_words, escape, group_words
from clipforge.config import CaptionsConfig
from clipforge.models import Word
from tests.conftest import make_words


def test_ass_time():
    assert ass_time(0) == "0:00:00.00"
    assert ass_time(61.234) == "0:01:01.23"
    assert ass_time(3725.999) == "1:02:06.00"
    assert ass_time(-1) == "0:00:00.00"


def test_ass_color_bgr():
    assert ass_color("#FFE600") == "&H0000E6FF"
    assert ass_color("#000000", alpha=0x40) == "&H40000000"
    with pytest.raises(ValueError):
        ass_color("red")


def test_group_max_words_and_punctuation():
    groups = group_words(make_words("uno due tre quattro. cinque sei"), max_words=3)
    assert [len(g.words) for g in groups] == [3, 1, 2]


def test_group_breaks_on_long_gap():
    w = [Word(start=0, end=0.3, text="a"), Word(start=2.0, end=2.3, text="b")]
    assert len(group_words(w, 3)) == 2


def test_clip_words_relative():
    w = make_words("a b c d e", start=10.0)
    rel = clip_words(w, 10.5, 12.0)
    assert rel[0].text == "b" and rel[0].start == pytest.approx(0.0)
    assert all(x.end <= 1.5 for x in rel)


def _events(ass):
    return [l for l in ass.splitlines() if l.startswith("Dialogue:")]


def test_karaoke_one_event_per_word_with_highlight():
    cfg = CaptionsConfig(hook=False)
    words = make_words("ciao a tutti", start=0.0)
    ev = _events(build_ass(words, 2.0, cfg))
    assert len(ev) == 3
    assert all(e.count("\\c&H") == 1 for e in ev)
    assert "{\\c&H0000E6FF\\fscx108\\fscy108}CIAO{\\r}" in ev[0]


def test_max_three_words_on_screen():
    cfg = CaptionsConfig(hook=False, uppercase=False)
    words = make_words("uno due tre quattro cinque sei sette")
    for e in _events(build_ass(words, 5.0, cfg)):
        text = re.sub(r"\{[^}]*\}", "", e.split(",,", 1)[1].split(",", 4)[-1])
        assert len(text.split()) <= 3


def test_hook_and_cta():
    cfg = CaptionsConfig(cta_text="Seguimi per la parte 2")
    ass = build_ass(make_words("testo"), 30.0, cfg, hook_title="Il segreto che nessuno ti dice")
    ev = _events(ass)
    hook = [e for e in ev if ",Hook," in e][0]
    cta = [e for e in ev if ",CTA," in e][0]
    assert "0:00:00.00,0:00:03.00" in hook and "\\N" in hook
    assert "0:00:28.00,0:00:30.00" in cta


def test_header_resolution_and_safe_zone():
    cfg = CaptionsConfig()
    ass = build_ass([], 10, cfg)
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    caption_style = [l for l in ass.splitlines() if l.startswith("Style: Caption")][0]
    assert caption_style.split(",")[-2] == str(cfg.margin_v)
    assert cfg.margin_v >= 400  # above TikTok/Reels bottom UI


def test_escape_braces():
    assert escape("a{b}\\c") == "a(b)\\\\c"
