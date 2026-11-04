import { describe, expect, it } from "vitest";

import type { SignalMatch } from "@/lib/radar/signals";
import {
  competitionLevel,
  computeTrendMetrics,
  CURIOSITY_BASE,
  CURIOSITY_POINTS,
  INTEREST_FACTORS,
  parseRadarExplanation,
  RADAR_WEIGHTS,
  round2,
  trendStatus,
  type MetricSource,
} from "@/lib/trends/metrics";

const NOW = new Date("2026-10-08T12:00:00Z");
const H = 3_600_000;

let seq = 0;
function src(hoursAgo: number, publisher: string, over: Partial<MetricSource> = {}): MetricSource {
  seq += 1;
  return { id: `s${seq}`, time: NOW.getTime() - hoursAgo * H, publisher, credibility: null, signals: [], ...over };
}
const sig = (signal: SignalMatch["signal"], ...terms: string[]): SignalMatch => ({ signal, terms });

/** a strong, fresh, curious story covered by 4 of 10 tracked outlets */
function sweetStory(): MetricSource[] {
  return [
    src(0.5, "a.com", { credibility: 0.9, signals: [sig("upset", "stuns")] }),
    src(1, "b.com", { credibility: 0.8, signals: [sig("upset", "shock"), sig("rivalry", "derby")] }),
    src(2, "c.com", { credibility: 0.7, signals: [sig("upset", "clamoroso"), sig("rivalry", "derby")] }),
    src(3, "d.com", { credibility: 0.8, signals: [sig("record", "first ever")] }),
    src(4, "a.com", { signals: [sig("upset", "upset")] }),
    src(5, "b.com", { signals: [sig("rivalry", "derby")] }),
    src(9, "c.com"),
  ];
}

describe("interest (trend_score)", () => {
  it("sums five explained factors; each saturates at its documented cap", () => {
    const sources = Array.from({ length: 12 }, (_, i) => src(0.5, `p${i % 8}.com`, { credibility: 1 }));
    const m = computeTrendMetrics({ sources, now: NOW, activePublishers: 20 });
    const byKey = Object.fromEntries(m.explanation.interest.factors.map((f) => [f.key, f]));
    expect(byKey.volume.points).toBe(INTEREST_FACTORS.volume.max);
    expect(byKey.publishers.points).toBe(INTEREST_FACTORS.publishers.max);
    expect(byKey.momentum.points).toBe(INTEREST_FACTORS.momentum.max);
    expect(byKey.recency.points).toBe(INTEREST_FACTORS.recency.max);
    expect(byKey.credibility.points).toBe(INTEREST_FACTORS.credibility.max);
    expect(m.interest).toBe(100);
  });

  it("scales linearly below saturation and treats unknown credibility as neutral", () => {
    const m = computeTrendMetrics({ sources: [src(25, "a.com"), src(26, "b.com")], now: NOW, activePublishers: 10 });
    const byKey = Object.fromEntries(m.explanation.interest.factors.map((f) => [f.key, f]));
    expect(byKey.volume.points).toBe(6); // 2/10 × 30
    expect(byKey.publishers.points).toBe(round2((2 / 6) * 25));
    expect(byKey.momentum.points).toBe(0);
    expect(byKey.recency.points).toBe(round2(((48 - 25) / 46) * 15));
    expect(byKey.credibility).toMatchObject({ value: null, points: INTEREST_FACTORS.credibility.unknownPoints });
    expect(byKey.credibility.detail).toMatch(/no publisher credibility rated/);
  });

  it("velocity compares the last 6h with the previous 6h (sources per hour)", () => {
    const m = computeTrendMetrics({ sources: [src(1, "a"), src(2, "b"), src(3, "c"), src(7, "d")], now: NOW, activePublishers: 4 });
    expect(m.last6h).toBe(3);
    expect(m.previous6h).toBe(1);
    expect(m.velocity).toBe(0.333); // (3 − 1) / 6h
    expect(m.explanation.velocity).toMatchObject({ last_6h: 3, previous_6h: 1 });
  });

  it("future publication dates (feed clock skew) count as now", () => {
    const m = computeTrendMetrics({ sources: [src(-3, "a.com")], now: NOW, activePublishers: 1 });
    expect(m.hoursSinceLast).toBe(0);
    expect(m.lastSeen).toBe(NOW.getTime());
  });
});

describe("curiosity", () => {
  it("is base + signal points scaled by the share of sources carrying each signal", () => {
    const sources = [src(1, "a", { signals: [sig("upset", "stuns")] }), src(1, "b"), src(1, "c"), src(1, "d")];
    const m = computeTrendMetrics({ sources, now: NOW, activePublishers: 4 });
    const upset = m.explanation.curiosity.factors.find((f) => f.signal === "upset")!;
    expect(upset).toMatchObject({ sources: 1, share: 0.25, max: CURIOSITY_POINTS.upset, terms: ["stuns"] });
    expect(upset.points).toBe(round2(25 * (0.5 + 0.5 * 0.25)));
    // 4 sources in the last 6h vs 0 → rising_trend counts too (trend-level signal, share 1)
    const rising = m.explanation.curiosity.factors.find((f) => f.signal === "rising_trend")!;
    expect(rising.points).toBe(CURIOSITY_POINTS.rising_trend);
    expect(m.curiosity).toBe(round2(CURIOSITY_BASE + upset.points + rising.points));
  });

  it("event signals count at full weight; the total is capped at 100", () => {
    const all = [sig("upset", "x"), sig("record", "x"), sig("controversy", "x"), sig("unusual_stat", "x"), sig("rivalry", "x"), sig("breaking", "x")];
    const m = computeTrendMetrics({
      sources: [src(1, "a", { signals: all }), src(30, "b", { signals: all })],
      now: NOW,
      activePublishers: 2,
      eventSignals: [sig("just_finished", "finished 2h ago")],
    });
    expect(m.signals).toContain("just_finished");
    expect(m.explanation.curiosity.capped).toBe(true);
    expect(m.curiosity).toBe(100);
    expect(m.explanation.curiosity.raw).toBeGreaterThan(100);
  });

  it("with no signals curiosity is the base", () => {
    const m = computeTrendMetrics({ sources: [src(20, "a")], now: NOW, activePublishers: 1 });
    expect(m.signals).toEqual([]);
    expect(m.curiosity).toBe(CURIOSITY_BASE);
  });
});

describe("competition (publisher saturation)", () => {
  it.each([
    [6, 50, "high"],
    [3, 4, "high"], // 75% of the outlets you track
    [3, 10, "medium"],
    [2, 4, "medium"], // 50%
    [2, 10, "low"],
    [1, 1, "low"], // one outlet only: nobody else to compete with yet
    [0, 0, "low"],
  ] as const)("%i publishers of %i active → %s", (publishers, active, level) => {
    expect(competitionLevel(publishers, active).level).toBe(level);
  });

  it("explains the rule that decided it", () => {
    expect(competitionLevel(6, 50).rule).toMatch(/6 publishers cover it/);
    expect(competitionLevel(3, 4).rule).toMatch(/75% of the 4 publishers/);
  });
});

describe("status rules", () => {
  it.each([
    [{ volume: 5, last6h: 0, previous6h: 0, hoursSinceLast: 80 }, "expired"],
    [{ volume: 5, last6h: 0, previous6h: 0, hoursSinceLast: null }, "expired"],
    [{ volume: 5, last6h: 0, previous6h: 0, hoursSinceLast: 13 }, "declining"],
    [{ volume: 6, last6h: 1, previous6h: 4, hoursSinceLast: 1 }, "declining"],
    // "coverage halved" needs ≥ 2 sources in the previous 6h: a quiet one-source story is still emerging
    [{ volume: 1, last6h: 0, previous6h: 1, hoursSinceLast: 8 }, "emerging"],
    [{ volume: 4, last6h: 0, previous6h: 1, hoursSinceLast: 7 }, "peaking"],
    [{ volume: 2, last6h: 2, previous6h: 0, hoursSinceLast: 1 }, "emerging"],
    [{ volume: 6, last6h: 4, previous6h: 2, hoursSinceLast: 1 }, "rising"],
    [{ volume: 6, last6h: 2, previous6h: 3, hoursSinceLast: 1 }, "peaking"],
    [{ volume: 6, last6h: 2, previous6h: 2, hoursSinceLast: 1 }, "peaking"],
  ] as const)("%o → %s", (input, status) => {
    expect(trendStatus(input).status).toBe(status);
  });
});

describe("radar score and sweet spot", () => {
  it("radar = 0.4 interest + 0.4 curiosity + 0.2 competition gap", () => {
    const m = computeTrendMetrics({ sources: sweetStory(), now: NOW, activePublishers: 10 });
    const c = m.explanation.radar.contributions;
    expect(c.interest).toBe(round2(m.interest * RADAR_WEIGHTS.interest));
    expect(c.curiosity).toBe(round2(m.curiosity * RADAR_WEIGHTS.curiosity));
    expect(c.competition_gap).toBe(round2(m.explanation.competition.gap * RADAR_WEIGHTS.competition_gap));
    expect(m.radarScore).toBe(round2(c.interest + c.curiosity + c.competition_gap));
  });

  it("a fresh, curious story at medium competition is a sweet spot", () => {
    const m = computeTrendMetrics({ sources: sweetStory(), now: NOW, activePublishers: 10 });
    expect(m.interest).toBeGreaterThanOrEqual(60);
    expect(m.curiosity).toBeGreaterThanOrEqual(60);
    expect(m.competition).toBe("medium");
    expect(m.status).toBe("rising");
    expect(m.isSweetSpot).toBe(true);
    expect(m.explanation.sweet_spot.checks.every((c) => c.pass)).toBe(true);
  });

  it("is not a sweet spot when competition is high", () => {
    const m = computeTrendMetrics({ sources: sweetStory(), now: NOW, activePublishers: 4 }); // 4/4 = 100% saturation
    expect(m.competition).toBe("high");
    expect(m.isSweetSpot).toBe(false);
    expect(m.explanation.sweet_spot.checks.find((c) => c.key === "competition")?.pass).toBe(false);
  });

  it("is not a sweet spot without curiosity or without interest", () => {
    const plain = sweetStory().map((s) => ({ ...s, signals: [] }));
    expect(computeTrendMetrics({ sources: plain, now: NOW, activePublishers: 10 }).isSweetSpot).toBe(false);
    const old = sweetStory().map((s) => ({ ...s, time: s.time - 40 * H }));
    const m = computeTrendMetrics({ sources: old, now: NOW, activePublishers: 10 });
    expect(m.interest).toBeLessThan(60);
    expect(m.isSweetSpot).toBe(false);
  });

  it("an expired trend is never a sweet spot", () => {
    const stale = sweetStory().map((s) => ({ ...s, time: s.time - 100 * H }));
    const m = computeTrendMetrics({ sources: stale, now: NOW, activePublishers: 10 });
    expect(m.status).toBe("expired");
    expect(m.isSweetSpot).toBe(false);
  });
});

describe("explanation completeness (no black box)", () => {
  const m = computeTrendMetrics({ sources: sweetStory(), now: NOW, activePublishers: 10, eventSignals: [sig("just_finished", "finished 3h ago")] });
  const e = m.explanation;

  it("lists every interest factor with points that add up to the score", () => {
    expect(e.interest.factors.map((f) => f.key)).toEqual(["volume", "publishers", "momentum", "recency", "credibility"]);
    expect(round2(e.interest.factors.reduce((s, f) => s + f.points, 0))).toBe(e.interest.score);
    for (const f of e.interest.factors) {
      expect(f.points).toBeGreaterThanOrEqual(0);
      expect(f.points).toBeLessThanOrEqual(f.max);
      expect(f.detail.length).toBeGreaterThan(5);
    }
  });

  it("explains every signal of the trend with its terms", () => {
    expect(e.curiosity.factors.map((f) => f.signal)).toEqual(m.signals);
    for (const f of e.curiosity.factors) expect(f.terms.length).toBeGreaterThan(0);
    expect(round2(e.curiosity.base + e.curiosity.factors.reduce((s, f) => s + f.points, 0))).toBe(e.curiosity.raw);
  });

  it("records competition, radar contributions, sweet-spot checks, status rule and velocity", () => {
    expect(e.competition).toMatchObject({ level: m.competition, publisher_count: 4, active_publishers: 10 });
    expect(e.radar.score).toBe(m.radarScore);
    expect(e.sweet_spot.checks.map((c) => c.key)).toEqual(["interest", "curiosity", "competition", "active"]);
    expect(e.status).toMatchObject({ value: m.status });
    expect(e.status.rule.length).toBeGreaterThan(5);
    expect(e.velocity.value).toBe(m.velocity);
  });

  it("round-trips through JSON and parses back", () => {
    expect(parseRadarExplanation(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(parseRadarExplanation(null)).toBeNull();
    expect(parseRadarExplanation({ version: "old" })).toBeNull();
  });
});
