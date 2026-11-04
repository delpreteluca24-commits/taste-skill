import pytest

from clipforge.config import Config, load_config
from clipforge.db import DB


def test_job_idempotent_and_steps(tmp_path):
    db = DB(tmp_path / "t.db")
    a = db.get_or_create_job("src", "vid", {"x": 1}, "h1")
    b = db.get_or_create_job("src", "vid", {"x": 1}, "h1")
    c = db.get_or_create_job("src", "vid", {"x": 2}, "h2")
    assert a["id"] == b["id"] != c["id"]
    j = a["id"]
    assert not db.step_done(j, "transcribe")
    db.start_step(j, "transcribe", "in1")
    db.fail_step(j, "transcribe", "boom")
    assert not db.step_done(j, "transcribe")
    db.start_step(j, "transcribe", "in1")
    db.finish_step(j, "transcribe", "/p")
    assert db.step_done(j, "transcribe", "in1")
    assert not db.step_done(j, "transcribe", "in2")  # input changed -> redo
    assert db.get_steps(j)[0]["attempts"] == 2


def test_clips_replace_and_update(tmp_path):
    db = DB(tmp_path / "t.db")
    j = db.get_or_create_job("s", "v", {}, "h")["id"]
    db.replace_clips(j, [{"clip_id": "v_01", "idx": 1, "start": 0, "end": 30, "score": 80}])
    db.update_clip("v_01", status="rendered", mp4_path="/x.mp4")
    assert db.get_clips(j)[0]["status"] == "rendered"
    db.replace_clips(j, [{"clip_id": "v_01", "idx": 1, "start": 5, "end": 35, "score": 70}])
    assert db.get_clips(j)[0]["status"] == "selected"
    with pytest.raises(ValueError):
        db.update_clip("v_01", score=1)
    assert db.get_job(j[:6])["id"] == j


def test_config_yaml_and_overrides(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("clips:\n  count: 4\nllm:\n  provider: groq:llama\n")
    cfg = load_config(p, {"clips": {"count": None, "max_s": 45}, "lang": "it"})
    assert cfg.clips.count == 4 and cfg.clips.max_s == 45 and cfg.lang == "it" and cfg.llm.provider == "groq:llama"


def test_config_hash_ignores_paths():
    a, b = Config(output_dir="a"), Config(output_dir="b")
    assert a.output_hash() == b.output_hash()
    assert a.output_hash() != Config(clips={"count": 3}).output_hash()


def test_min_max_validation():
    with pytest.raises(ValueError):
        Config(clips={"min_s": 60, "max_s": 20})
