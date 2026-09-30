import random

import pytest

from clipforge.tracking import (apply_deadzone, clamp_speed, fill_missing, interpolate, kalman_rts, kmeans_1d_two,
                                smooth_track, speaker_timeline)


def test_kalman_reduces_jitter_and_tracks_motion():
    rnd = random.Random(1)
    ts = [i / 5 for i in range(100)]
    truth = [500 + 40 * t for t in ts]
    zs = [x + rnd.gauss(0, 20) for x in truth]
    xs = kalman_rts(ts, zs, q=2e3, r=400)
    err_raw = sum(abs(z - x) for z, x in zip(zs, truth)) / len(ts)
    err_kf = sum(abs(a - x) for a, x in zip(xs, truth)) / len(ts)
    assert err_kf < err_raw / 2


def test_kalman_handles_missing():
    ts = [0, 1, 2, 3, 4]
    xs = kalman_rts(ts, [100, None, None, 100, None], q=10, r=1)
    assert all(abs(x - 100) < 5 for x in xs)
    assert kalman_rts(ts, [None] * 5, 1, 1) == [0.0] * 5


def test_deadzone_holds_small_moves():
    assert apply_deadzone([100, 105, 95, 100], 10) == [100, 100, 100, 100]
    assert apply_deadzone([100, 130], 10) == [100, 120]


def test_clamp_speed():
    assert clamp_speed([0, 1, 2], [0, 1000, 1000], 100) == [0, 100, 200]


def test_smooth_track_default_when_empty():
    assert smooth_track([0, 1], [None, None], default=960, deadzone=10, max_speed=100) == [960, 960]


def test_fill_missing():
    assert fill_missing([None, 5, None, 7], 0) == [5, 5, 5, 7]


def test_kmeans_two():
    assert kmeans_1d_two([100, 110, 90, 900, 910]) == pytest.approx((100, 905))


def test_speaker_timeline_switches_with_min_shot():
    ts = [i / 5 for i in range(80)]  # 16 s
    a = [3.0 if (t // 4) % 2 == 0 else 0.0 for t in ts]
    b = [0.0 if (t // 4) % 2 == 0 else 3.0 for t in ts]
    who = speaker_timeline(ts, a, b, min_shot_s=1.5)
    cuts = [ts[i] for i in range(1, len(ts)) if who[i] != who[i - 1]]
    assert who[0] == 0 and len(cuts) == 3
    assert all(abs(c - e) <= 0.6 for c, e in zip(cuts, (4, 8, 12)))


def test_speaker_timeline_ignores_short_bursts():
    ts = [i / 5 for i in range(50)]
    a = [2.0] * 50
    b = [5.0 if 20 <= i < 22 else 0.0 for i in range(50)]  # 0.4 s burst
    who = speaker_timeline(ts, a, b, min_shot_s=1.5, window=1)
    assert set(who) == {0}


def test_interpolate_linear_and_hard_cut():
    path = interpolate([0, 1], [0, 100], fps=10, duration=1)
    assert path[5] == (0.5, pytest.approx(50))
    cut = interpolate([0, 1], [0, 100], fps=10, duration=1, hard_cuts=[0.7])
    assert cut[6][1] == 0 and cut[7][1] == 100
