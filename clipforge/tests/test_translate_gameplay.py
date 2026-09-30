import json

import pytest

from clipforge.gameplay import list_gameplay, pick_gameplay
from clipforge.translate import sentences, spread_words, translate_clip
from tests.conftest import make_words
from tests.test_llm_parsing import FakeLLM

META = {"hook_title": "Ciao", "title": "Titolo", "description": "Descr", "hashtags": ["#it"]}


def test_sentences_split_on_punctuation_and_gap():
    w = make_words("uno due. tre quattro cinque")
    assert [len(s) for s in sentences(w)] == [2, 3]


def test_spread_words_keeps_span():
    out = spread_words("hello big world", 1.0, 4.0)
    assert out[0].start == 1.0 and out[-1].end <= 4.0 and [w.text for w in out] == ["hello", "big", "world"]
    assert out[1].start >= out[0].end


def test_translate_retries_missing_lines_and_keeps_timing():
    w = make_words("ciao a tutti. come state oggi?")
    partial = json.dumps({"lines": [{"i": 0, "text": "hi everyone."}], "hook_title": "Hi", "title": "T"})
    full = json.dumps({"lines": [{"i": 0, "text": "hi everyone."}, {"i": 1, "text": "how are you today?"}],
                       "hook_title": "Hi", "title": "Title", "description": "D", "hashtags": ["hello world"]})
    llm = FakeLLM([partial, full])
    words, meta = translate_clip(llm, w, META, "en")
    assert [x.text for x in words] == ["hi", "everyone.", "how", "are", "you", "today?"]
    assert words[0].start == w[0].start and words[-1].end <= w[-1].end
    assert meta["hashtags"] == ["#helloworld"] and "missing line" in llm.prompts[1]


def test_translate_falls_back_to_original_lines():
    w = make_words("ciao. mondo.")
    only0 = json.dumps({"lines": [{"i": 0, "text": "hi."}], "hook_title": "H", "title": "T"})
    words, _ = translate_clip(FakeLLM([only0]), w, META, "en", max_retries=0)
    assert [x.text for x in words] == ["hi.", "mondo."]


def test_translate_fails_loudly():
    with pytest.raises(RuntimeError):
        translate_clip(FakeLLM(["nope"]), make_words("ciao."), META, "en", max_retries=0)


def test_gameplay_pick_deterministic(tmp_path):
    for n in ("a.mp4", "b.mkv", "notes.txt"):
        (tmp_path / n).write_bytes(b"x")
    assert [p.name for p in list_gameplay(tmp_path)] == ["a.mp4", "b.mkv"]
    g1 = pick_gameplay(tmp_path, "vid_01", 30, 768, duration_of=lambda p: 600)
    g2 = pick_gameplay(tmp_path, "vid_01", 30, 768, duration_of=lambda p: 600)
    assert g1 == g2 and 0 <= g1.offset <= 570 and g1.height == 768
    short = pick_gameplay(tmp_path / "a.mp4", "x", 30, 768, duration_of=lambda p: 10)
    assert short.offset == 0.0  # shorter than the clip: loops from the start


def test_gameplay_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        list_gameplay(tmp_path / "nope")
    with pytest.raises(FileNotFoundError):
        pick_gameplay(tmp_path, "x", 30, 768)
