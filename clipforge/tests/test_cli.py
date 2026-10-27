"""CLI end-to-end: flag parsing + config merge + pipeline (LLM and whisper replaced by fakes)."""
import json

import pytest
from typer.testing import CliRunner

from clipforge.cli import app
from tests.conftest import make_transcript
from tests.test_integration import FF, video  # noqa: F401  (fixture)
from tests.test_llm_parsing import FakeLLM

pytestmark = pytest.mark.skipif(FF is None, reason="ffmpeg not available")


def test_cli_run_then_status_and_publish_dry_run(video, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.chdir(tmp_path)  # no config.yaml here: pure CLI defaults + flags
    monkeypatch.setattr("clipforge.config.Path.home", lambda: tmp_path)
    tr = make_transcript([f"questa è la frase numero {i} del video." for i in range(6)])
    ans = json.dumps({"clips": [{"start_seg": 0, "end_seg": 3, "score": 77, "hook_title": "H", "title": "T",
                                 "description": "d", "hashtags": ["x"], "reason": "r"}]})
    monkeypatch.setattr("clipforge.pipeline.transcribe", lambda media, cfg: tr)
    monkeypatch.setattr("clipforge.pipeline.get_provider", lambda spec, cfg: FakeLLM([ans]))
    r = CliRunner().invoke(app, ["run", str(video), "-n", "1", "--min", "5", "--max", "15", "--mode", "center",
                                 "--style", "simple", "-o", str(tmp_path / "out")])
    assert r.exit_code == 0, r.output
    clip_json = next((tmp_path / "out").rglob("clip_01.json"))
    assert json.loads(clip_json.read_text())["render"]["style"] == "simple"
    r = CliRunner().invoke(app, ["status"])
    assert r.exit_code == 0 and "done" in r.output
    r = CliRunner().invoke(app, ["publish", "youtube", str(clip_json), "--dry-run"])
    assert r.exit_code == 0, r.output


def test_cli_bad_flag_value(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    r = CliRunner().invoke(app, ["run", "x.mp4", "--mode", "zoom"])
    assert r.exit_code == 1 and "Error" in r.output
