from clipforge.chunking import fmt_ts, render_window, windows
from tests.conftest import make_transcript


def test_windows_overlap_and_cover_everything():
    tr = make_transcript([f"frase numero {i}." for i in range(200)])  # ~2.1 s each
    wins = windows(tr.segments, window_s=60, overlap_s=10)
    ids = {s.id for w in wins for s in w}
    assert ids == set(range(200))
    assert len(wins) > 1 and wins[0][-1].id >= wins[1][0].id  # overlap


def test_render_window():
    tr = make_transcript(["ciao a tutti."])
    assert render_window(tr.segments).startswith("[0] (00:00, ")
    assert fmt_ts(3725) == "1:02:05"
