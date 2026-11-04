import json

import pytest

from clipforge.highlights import ask_window, dedupe_rank, extract_json, parse_llm_response
from clipforge.llm.base import LLMError, LLMProvider, get_provider, inline_refs
from clipforge.models import ClipCandidate, LLMResponse
from tests.conftest import make_transcript

CLIP = {"start_seg": 1, "end_seg": 4, "score": 81, "hook_title": "Nessuno lo dice",
        "reason": "twist", "title": "Il segreto", "description": "d", "hashtags": ["soldi", "#Finanza Personale", "#soldi"]}


def test_plain_object():
    r = parse_llm_response(json.dumps({"clips": [CLIP]}))
    assert r.clips[0].score == 81
    assert r.clips[0].hashtags == ["#soldi", "#FinanzaPersonale"]


def test_code_fence_and_prose():
    raw = "Ecco i clip:\n```json\n" + json.dumps({"clips": [CLIP]}) + "\n```\nSpero aiuti!"
    assert len(parse_llm_response(raw).clips) == 1


def test_bare_list_and_single_object():
    assert len(parse_llm_response(json.dumps([CLIP, CLIP])).clips) == 2
    assert len(parse_llm_response(json.dumps(CLIP)).clips) == 1


def test_prose_around_object():
    raw = "Sure! " + json.dumps({"clips": [CLIP]}) + " Done."
    assert parse_llm_response(raw).clips[0].title == "Il segreto"


def test_partial_valid_items_are_kept():
    bad = dict(CLIP, score=150)
    r = parse_llm_response(json.dumps({"clips": [bad, CLIP]}))
    assert len(r.clips) == 1


@pytest.mark.parametrize("bad", [dict(CLIP, score=101), dict(CLIP, start_seg=5, end_seg=2), dict(CLIP, title="")])
def test_invalid_rejected(bad):
    with pytest.raises(ValueError):
        parse_llm_response(json.dumps({"clips": [bad]}))


def test_not_json():
    with pytest.raises(ValueError):
        extract_json("I cannot help with that")


def test_schema_inlined_has_no_refs():
    s = json.dumps(inline_refs(LLMResponse.model_json_schema()))
    assert "$ref" not in s and "$defs" not in s and "start_seg" in s


def test_unknown_provider():
    with pytest.raises(LLMError):
        get_provider("openai:gpt", None)


class FakeLLM(LLMProvider):
    name = "fake"

    def __init__(self, answers):
        super().__init__("fake", None)
        self.answers, self.prompts = list(answers), []

    def complete_json(self, system, user, schema):
        self.prompts.append(user)
        return self.answers.pop(0)


def test_retry_with_error_feedback():
    tr = make_transcript([f"frase numero {i} molto interessante." for i in range(6)])
    llm = FakeLLM(["not json", json.dumps({"clips": [dict(CLIP, end_seg=3)]})])
    out = ask_window(llm, tr.segments, 3, "it", 1, 60, max_retries=2)
    assert len(out) == 1 and "previous answer was invalid" in llm.prompts[1]


def test_ids_outside_window_dropped():
    tr = make_transcript([f"frase {i}." for i in range(3)])
    llm = FakeLLM([json.dumps({"clips": [dict(CLIP, start_seg=1, end_seg=9)]})])
    assert ask_window(llm, tr.segments, 3, "it", 1, 60, max_retries=0) == []


def test_dedupe_rank_no_overlap_sorted():
    mk = lambda s, e, sc: ClipCandidate(start=s, end=e, score=sc, hook_title="h", title="t")
    out = dedupe_rank([mk(0, 30, 50), mk(20, 50, 90), mk(60, 90, 70), mk(95, 120, 10)], n=3)
    assert [c.score for c in out] == [90, 70, 10]
