import pytest

from clipforge.config import Config
from clipforge.models import Segment, Transcript, Word


def make_words(text: str, start: float = 0.0, word_s: float = 0.4, gap: float = 0.1) -> list[Word]:
    out, t = [], start
    for tok in text.split():
        out.append(Word(start=round(t, 3), end=round(t + word_s, 3), text=tok))
        t += word_s + gap
    return out


def make_transcript(sentences: list[str], pause: float = 0.6, lang: str = "it") -> Transcript:
    segs, t = [], 0.0
    for i, s in enumerate(sentences):
        words = make_words(s, start=t)
        segs.append(Segment(id=i, start=words[0].start, end=words[-1].end, text=s, words=words))
        t = words[-1].end + pause
    return Transcript(language=lang, duration=t, model="test", segments=segs)


@pytest.fixture
def cfg(tmp_path) -> Config:
    return Config(cache_dir=tmp_path / "cache", output_dir=tmp_path / "out")
