import pytest

from clipforge.config import ReframeConfig
from clipforge.detect import Face, iou, nms
from clipforge.reframe import Panel, ReframePlan, plan_face, static_plan
from clipforge.render import GameplaySource, build_filtergraph

RC = ReframeConfig()


def face(cx, w=180, y=400):
    return Face(cx - w / 2, y, w, w, 0.9)


def samples(fn, n=80, fps=5):
    return [(i / fps, *fn(i / fps)) for i in range(n)]


def test_no_faces_gives_static_centre():
    p = plan_face(samples(lambda t: ([], [])), 1920, 1080, 1080, 1920, 25, 16, RC)
    assert p.layout == "single" and not p.panels[0].dynamic and p.panels[0].x0 == 656


def test_single_face_is_followed():
    p = plan_face(samples(lambda t: ([face(400 + 60 * t)], [0.0])), 1920, 1080, 1080, 1920, 25, 16, RC)
    xs = [x for _, x in p.panels[0].path]
    assert p.layout == "single" and xs[-1] > xs[0] + 500
    assert all(x % 2 == 0 and 0 <= x <= 1920 - 606 for x in xs)


def test_two_far_speakers_switch():
    def fn(t):
        a_on = (t // 4) % 2 == 0
        return [face(380), face(1540)], [3.0 if a_on else 0.0, 0.0 if a_on else 3.0]
    p = plan_face(samples(fn), 1920, 1080, 1080, 1920, 25, 16, RC)
    assert p.layout == "switch" and p.info["switches"] == 3
    xs = dict(p.panels[0].path)
    assert xs[2.0] < 300 and xs[6.0] > 1100


def test_two_speakers_split():
    rc = ReframeConfig(speakers="split")
    p = plan_face(samples(lambda t: ([face(380), face(1540)], [1.0, 1.0])), 1920, 1080, 1080, 1920, 25, 16, rc)
    assert p.layout == "split" and len(p.panels) == 2
    assert p.panels[0].out_h == 960 and p.panels[0].x0 < p.panels[1].x0


def test_split_not_allowed_with_gameplay():
    rc = ReframeConfig(speakers="split")
    p = plan_face(samples(lambda t: ([face(380), face(1540)], [1.0, 0.0])), 1920, 1080, 1080, 1152, 25, 16, rc,
                  allow_split=False)
    assert p.layout == "switch"


def test_close_faces_stay_single():
    p = plan_face(samples(lambda t: ([face(900), face(1050)], [1.0, 0.0])), 1920, 1080, 1080, 1920, 25, 16, RC)
    assert p.layout == "single"


def test_sendcmd_only_on_change_and_roundtrip():
    p = ReframePlan("single", [Panel(606, 1080, 0, 1080, 1920, [(0.0, 10), (0.04, 10), (0.08, 12)])])
    assert p.sendcmd() == "0.000 crop@p0 x 10;\n0.080 crop@p0 x 12;\n"
    assert ReframePlan.from_dict(p.to_dict()) == p


def test_filtergraph_single_static():
    g = build_filtergraph(static_plan(1920, 1080, 1080, 1920), None, "c.ass", None, None, 1080)
    assert g.startswith("[0:v]crop@p0=606:1080:656:0,scale=1080:1920") and g.endswith("[main]ass='c.ass'[v]")


def test_filtergraph_split_and_gameplay():
    two = ReframePlan("split", [Panel(1214, 1080, 0, 1080, 960, [(0, 0), (1, 2)]),
                                Panel(1214, 1080, 0, 1080, 960, [(0, 700)])])
    g = build_filtergraph(two, "c.cmd", None, None, None, 1080)
    assert "sendcmd=f='c.cmd',split=2[s0][s1]" in g and "vstack=inputs=2[main]" in g and g.endswith("[main]null[v]")
    one = static_plan(1920, 1080, 1080, 1152)
    g = build_filtergraph(one, None, "c.ass", None, GameplaySource("g.mp4", 3.0, 768), 1080)
    assert "[1:v]scale=1080:768:force_original_aspect_ratio=increase,crop=1080:768" in g
    assert "[main][game]vstack=inputs=2[stack]" in g and "fps=30" in g


def test_nms_and_iou():
    a, b = Face(0, 0, 10, 10, 0.9), Face(1, 1, 10, 10, 0.8)
    assert iou(a, b) > 0.6 and nms([b, a]) == [a]
    assert len(nms([a, Face(50, 50, 10, 10, 0.5)])) == 2
