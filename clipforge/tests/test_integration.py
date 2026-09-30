"""End-to-end: local file -> (injected transcript + fake LLM) -> rendered 9:16 clips + json + report."""
import json
import subprocess

import pytest

from clipforge import ffmpeg
from clipforge.pipeline import run
from tests.conftest import make_transcript
from tests.test_llm_parsing import FakeLLM

try:
    FF = ffmpeg.ffmpeg_bin()
except ffmpeg.FFmpegError:
    FF = None

pytestmark = [pytest.mark.ffmpeg, pytest.mark.skipif(FF is None, reason="ffmpeg not available")]


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    p = tmp_path_factory.mktemp("src") / "talk.mp4"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=40",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:d=40", "-af", "volume=0.1",
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(p)], check=True)
    return p


def test_pipeline_end_to_end(video, cfg):
    cfg.clips.count, cfg.clips.min_s, cfg.clips.max_s = 2, 5, 15
    cfg.render.preset = "ultrafast"
    cfg.captions.cta_text = "Seguimi"
    tr = make_transcript([f"questa è la frase numero {i} del video." for i in range(9)], lang="it")
    answer = {"clips": [
        {"start_seg": 0, "end_seg": 2, "score": 60, "hook_title": "Primo hook", "title": "Uno",
         "description": "d", "hashtags": ["a"], "reason": "r"},
        {"start_seg": 4, "end_seg": 6, "score": 90, "hook_title": "Secondo hook", "title": "Due",
         "description": "d", "hashtags": ["b"], "reason": "r"},
        {"start_seg": 1, "end_seg": 3, "score": 50, "hook_title": "overlap", "title": "Tre",
         "description": "d", "hashtags": [], "reason": "r"},
    ]}
    llm = FakeLLM([json.dumps(answer)])
    report = run(str(video), cfg, llm=llm, transcript=tr)

    out = report.parent
    assert report.exists() and "Secondo hook" in report.read_text()
    metas = sorted(out.glob("clip_*.json"))
    assert len(metas) == 2  # overlapping 3rd clip removed
    m = json.loads(metas[0].read_text())
    assert m["schema_version"] == 1 and m["files"]["video"] == "clip_01.mp4" and m["score"] == 90
    for n in ("clip_01", "clip_02"):
        p = ffmpeg.probe(out / f"{n}.mp4")
        assert (p.width, p.height) == (1080, 1920) and p.has_audio
        assert 5 <= p.duration <= 16
        assert (out / f"{n}.ass").exists() and (out / f"{n}.jpg").exists()

    # Resume: second run reuses everything (LLM not called again)
    mtime = (out / "clip_01.mp4").stat().st_mtime
    run(str(video), cfg, llm=FakeLLM([]), transcript=tr)
    assert (out / "clip_01.mp4").stat().st_mtime == mtime
