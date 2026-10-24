import sys
import types
from types import SimpleNamespace as NS

from clipforge.models import MediaInfo
from clipforge.transcribe import transcribe


def test_transcribe_parses_and_caches(cfg, monkeypatch, tmp_path):
    calls = []

    class FakeModel:
        def __init__(self, name, device, compute_type):
            calls.append((name, device, compute_type))

        def transcribe(self, audio, **kw):
            assert kw["word_timestamps"] and kw["vad_filter"]
            segs = [
                NS(start=0.0, end=1.0, text=" Ciao a tutti.", words=[
                    NS(start=0.0, end=0.3, word=" Ciao", probability=0.9),
                    NS(start=0.35, end=0.5, word=" a", probability=0.9),
                    NS(start=0.55, end=1.0, word=" tutti.", probability=0.8)]),
                NS(start=1.2, end=1.5, text=" ", words=[NS(start=1.2, end=1.5, word=" ", probability=0.1)]),
            ]
            return iter(segs), NS(language="it", duration=2.0)

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeModel))
    monkeypatch.setattr("clipforge.transcribe.resolve_whisper", lambda *a: ("small", "cpu", "int8"))
    media = MediaInfo(video_id="v", title="t", source="s", path="v.mp4", audio_path="a.wav", media_hash="abc",
                      duration=2.0, width=1920, height=1080)
    tr = transcribe(media, cfg)
    assert tr.language == "it" and len(tr.segments) == 1  # empty segment dropped
    assert [w.text for w in tr.words()] == ["Ciao", "a", "tutti."]
    tr2 = transcribe(media, cfg)  # second call hits the disk cache
    assert tr2 == tr and len(calls) == 1
