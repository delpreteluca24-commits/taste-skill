"""Pure math for camera paths: Kalman+RTS smoothing, deadzone, speed clamp, speaker switching.

Everything works on sampled series `ts` (seconds from clip start) and values in source pixels.
`None` marks a sample without a measurement (no face / no motion).
"""
from __future__ import annotations

from typing import Optional, Sequence


def fill_missing(zs: Sequence[Optional[float]], default: float) -> list[float]:
    """Hold the last known value; leading gaps take the first known value (or `default`)."""
    first = next((z for z in zs if z is not None), default)
    out, last = [], first
    for z in zs:
        last = z if z is not None else last
        out.append(last)
    return out


def kalman_rts(ts: Sequence[float], zs: Sequence[Optional[float]], q: float, r: float) -> list[float]:
    """Constant-velocity Kalman filter + Rauch-Tung-Striebel smoother (offline: no lag).

    q: process noise (how fast the subject may accelerate), r: measurement noise (detector jitter), px^2.
    """
    n = len(ts)
    if n == 0:
        return []
    z0 = next((z for z in zs if z is not None), None)
    if z0 is None:
        return [0.0] * n
    x = [z0, 0.0]
    P = [[r, 0.0], [0.0, 1e4]]
    xs_f, Ps_f, xs_p, Ps_p, Fs = [], [], [], [], []
    for i in range(n):
        dt = ts[i] - ts[i - 1] if i else 0.0
        F = [[1.0, dt], [0.0, 1.0]]
        # predict
        xp = [x[0] + dt * x[1], x[1]]
        q11, q12, q22 = q * dt ** 3 / 3, q * dt ** 2 / 2, q * dt
        Pp = [
            [P[0][0] + dt * (P[1][0] + P[0][1]) + dt * dt * P[1][1] + q11, P[0][1] + dt * P[1][1] + q12],
            [P[1][0] + dt * P[1][1] + q12, P[1][1] + q22],
        ]
        # update
        z = zs[i]
        if z is not None:
            s = Pp[0][0] + r
            k0, k1 = Pp[0][0] / s, Pp[1][0] / s
            y = z - xp[0]
            x = [xp[0] + k0 * y, xp[1] + k1 * y]
            P = [[(1 - k0) * Pp[0][0], (1 - k0) * Pp[0][1]], [Pp[1][0] - k1 * Pp[0][0], Pp[1][1] - k1 * Pp[0][1]]]
        else:
            x, P = xp, Pp
        xs_f.append(x); Ps_f.append(P); xs_p.append(xp); Ps_p.append(Pp); Fs.append(F)
    # RTS backward pass
    xs_s = [list(v) for v in xs_f]
    for i in range(n - 2, -1, -1):
        P, Pp, F = Ps_f[i], Ps_p[i + 1], Fs[i + 1]
        # C = P F^T Pp^-1
        det = Pp[0][0] * Pp[1][1] - Pp[0][1] * Pp[1][0]
        if abs(det) < 1e-12:
            continue
        inv = [[Pp[1][1] / det, -Pp[0][1] / det], [-Pp[1][0] / det, Pp[0][0] / det]]
        PFt = [[P[0][0] * F[0][0] + P[0][1] * F[0][1], P[0][0] * F[1][0] + P[0][1] * F[1][1]],
               [P[1][0] * F[0][0] + P[1][1] * F[0][1], P[1][0] * F[1][0] + P[1][1] * F[1][1]]]
        C = [[PFt[0][0] * inv[0][0] + PFt[0][1] * inv[1][0], PFt[0][0] * inv[0][1] + PFt[0][1] * inv[1][1]],
             [PFt[1][0] * inv[0][0] + PFt[1][1] * inv[1][0], PFt[1][0] * inv[0][1] + PFt[1][1] * inv[1][1]]]
        d0 = xs_s[i + 1][0] - xs_p[i + 1][0]
        d1 = xs_s[i + 1][1] - xs_p[i + 1][1]
        xs_s[i] = [xs_f[i][0] + C[0][0] * d0 + C[0][1] * d1, xs_f[i][1] + C[1][0] * d0 + C[1][1] * d1]
    return [v[0] for v in xs_s]


def apply_deadzone(xs: Sequence[float], dz: float) -> list[float]:
    """Camera stays still until the target leaves a ±dz band around it, then follows at the band edge."""
    if not xs:
        return []
    cam, out = xs[0], []
    for x in xs:
        if x > cam + dz:
            cam = x - dz
        elif x < cam - dz:
            cam = x + dz
        out.append(cam)
    return out


def clamp_speed(ts: Sequence[float], xs: Sequence[float], vmax: float) -> list[float]:
    if not xs:
        return []
    out = [xs[0]]
    for i in range(1, len(xs)):
        step = vmax * (ts[i] - ts[i - 1])
        out.append(min(max(xs[i], out[-1] - step), out[-1] + step))
    return out


def smooth_track(ts: Sequence[float], zs: Sequence[Optional[float]], *, default: float, deadzone: float,
                 max_speed: float, q: float = 2e4, r: float = 400.0) -> list[float]:
    if all(z is None for z in zs):
        return [default] * len(ts)
    xs = kalman_rts(ts, zs, q, r)
    xs = apply_deadzone(xs, deadzone)
    return clamp_speed(ts, xs, max_speed)


def kmeans_1d_two(values: Sequence[float], iters: int = 20) -> tuple[float, float]:
    """Two cluster centres (left, right) for face x positions."""
    lo, hi = min(values), max(values)
    c = [lo, hi]
    for _ in range(iters):
        groups: list[list[float]] = [[], []]
        for v in values:
            groups[0 if abs(v - c[0]) <= abs(v - c[1]) else 1].append(v)
        new = [sum(g) / len(g) if g else c[i] for i, g in enumerate(groups)]
        if new == c:
            break
        c = new
    return min(c), max(c)


def moving_average(xs: Sequence[float], k: int) -> list[float]:
    if k <= 1:
        return list(xs)
    out, acc, half = [], 0.0, k // 2
    pre = [0.0]
    for x in xs:
        acc += x
        pre.append(acc)
    n = len(xs)
    for i in range(n):
        a, b = max(0, i - half), min(n, i + half + 1)
        out.append((pre[b] - pre[a]) / (b - a))
    return out


def speaker_timeline(ts: Sequence[float], act_a: Sequence[float], act_b: Sequence[float],
                     min_shot_s: float, window: int = 5, margin: float = 1.15,
                     confirm_s: float = 0.6) -> list[int]:
    """0/1 per sample: who is talking.

    The other speaker must dominate (by `margin`) for `confirm_s` before a cut, so short interjections
    don't trigger one; the cut is then placed where they started talking. Shots last >= `min_shot_s`.
    """
    a, b = moving_average(act_a, window), moving_average(act_b, window)
    n = len(ts)
    if n == 0:
        return []
    head = max(1, window)
    cur = 0 if sum(a[:head]) >= sum(b[:head]) else 1
    last_cut, pending = ts[0], None
    out: list[int] = []
    for i in range(n):
        mine, other = (a[i], b[i]) if cur == 0 else (b[i], a[i])
        if other > mine * margin and other > 1e-6:
            pending = i if pending is None else pending
            if ts[i] - ts[pending] >= confirm_s and ts[pending] - last_cut >= min_shot_s:
                cur = 1 - cur
                for j in range(pending, i):
                    out[j] = cur
                last_cut, pending = ts[pending], None
        else:
            pending = None
        out.append(cur)
    # merge a too-short final shot into the previous one
    if ts[-1] - last_cut < min_shot_s and last_cut > ts[0]:
        prev = 1 - out[-1]
        out = [prev if t >= last_cut else s for t, s in zip(ts, out)]
    return out


def interpolate(ts: Sequence[float], xs: Sequence[float], fps: float, duration: float,
                hard_cuts: Sequence[float] = ()) -> list[tuple[float, float]]:
    """Resample a path at output frame rate. Across a hard cut the value jumps instead of panning."""
    if not ts:
        return []
    cuts = sorted(hard_cuts)
    out, j = [], 0
    nframes = max(1, int(duration * fps))
    for f in range(nframes):
        t = f / fps
        while j + 1 < len(ts) and ts[j + 1] <= t:
            j += 1
        if t <= ts[0]:
            x = xs[0]
        elif j + 1 >= len(ts):
            x = xs[-1]
        else:
            t0, t1 = ts[j], ts[j + 1]
            if any(t0 < c <= t1 for c in cuts):
                x = xs[j] if t < next(c for c in cuts if t0 < c <= t1) else xs[j + 1]
            else:
                x = xs[j] + (xs[j + 1] - xs[j]) * (t - t0) / (t1 - t0)
        out.append((round(t, 3), x))
    return out
