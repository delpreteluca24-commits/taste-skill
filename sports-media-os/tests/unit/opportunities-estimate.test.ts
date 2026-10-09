import { describe, expect, it } from "vitest";

import {
  angleOverlap,
  buildWhyNow,
  estimateAudience,
  estimateCompetitionGap,
  estimateComponents,
  estimateCuriosity,
  estimateMonetization,
  estimateOriginality,
  estimateProductionFeasibility,
  estimateRightsSafety,
  estimateTimeliness,
  estimateTrend,
  SPORT_AUDIENCE_BASELINE,
  type TrendFacts,
} from "@/lib/opportunities/estimate";

const NOW = new Date("2026-10-08T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function trend(over: Partial<TrendFacts> = {}): TrendFacts {
  return {
    title: "Bologna beat Inter 3-0 at San Siro",
    trend_score: 72,
    curiosity_score: null,
    competition_level: null,
    publisher_count: 4,
    source_count: 9,
    signals: [],
    last_seen_at: hoursFromNow(-2),
    status: "rising",
    is_sweet_spot: false,
    ...over,
  };
}

const football = { slug: "football", name: "Football (Soccer)" };

describe("trend", () => {
  it("uses the radar trend score and explains the coverage", () => {
    const e = estimateTrend(trend());
    expect(e).toMatchObject({ value: 72, origin: "heuristic" });
    expect(e.reason).toMatch(/Radar trend score 72/);
    expect(e.reason).toMatch(/9 sources from 4 publishers/);
  });

  it("falls back to coverage counts when the radar has no score yet", () => {
    const e = estimateTrend(trend({ trend_score: null, publisher_count: 3, source_count: 5 }));
    expect(e.value).toBe(20 + 30 + 10);
    expect(e.reason).toMatch(/estimated from coverage/);
  });

  it("does not guess without a trend or any metric", () => {
    expect(estimateTrend(null).value).toBeNull();
    expect(estimateTrend(trend({ trend_score: null, publisher_count: null, source_count: null })).value).toBeNull();
  });
});

describe("timeliness", () => {
  const event = (over: Record<string, unknown>) => ({ title: "Inter vs Bologna", starts_at: null, ends_at: null, status: "scheduled" as const, ...over });

  it("an event upcoming within 72h is timely (closer = higher)", () => {
    const in24 = estimateTimeliness({ event: event({ starts_at: hoursFromNow(24) }), now: NOW });
    const in70 = estimateTimeliness({ event: event({ starts_at: hoursFromNow(70) }), now: NOW });
    expect(in24.value).toBe(93);
    expect(in70.value).toBeGreaterThanOrEqual(80);
    expect(in24.value!).toBeGreaterThan(in70.value!);
    expect(in24.reason).toMatch(/starts in 24h \(within 72h\)/);
  });

  it("an event finished within 24h is timely; days later it is not", () => {
    const recent = estimateTimeliness({ event: event({ starts_at: hoursFromNow(-8), ends_at: hoursFromNow(-6), status: "finished" }), now: NOW });
    expect(recent.value).toBe(91);
    expect(recent.reason).toMatch(/finished 6h ago .*within 24h/);
    const old = estimateTimeliness({ event: event({ starts_at: hoursFromNow(-200), ends_at: hoursFromNow(-198), status: "finished" }), now: NOW });
    expect(old.value).toBe(15);
    expect(old.reason).toMatch(/news cycle has moved on/);
  });

  it("uses the start time when the end time is unknown, and says so", () => {
    const e = estimateTimeliness({ event: event({ starts_at: hoursFromNow(-12), status: "finished" }), now: NOW });
    expect(e.value).toBeGreaterThanOrEqual(80);
    expect(e.reason).toMatch(/end time unknown/);
  });

  it("a live event is maximally timely", () => {
    expect(estimateTimeliness({ event: event({ status: "live", starts_at: hoursFromNow(-1) }), now: NOW }).value).toBe(100);
  });

  it("an event more than a week away is not timely yet", () => {
    expect(estimateTimeliness({ event: event({ starts_at: hoursFromNow(240) }), now: NOW }).value).toBe(30);
  });

  it("falls back to trend recency and takes the more timely of the two", () => {
    const fresh = estimateTimeliness({ trend: trend({ last_seen_at: hoursFromNow(-1) }), now: NOW });
    expect(fresh.value).toBe(90);
    const both = estimateTimeliness({
      trend: trend({ last_seen_at: hoursFromNow(-1) }),
      event: event({ starts_at: hoursFromNow(-200), ends_at: hoursFromNow(-198), status: "finished" }),
      now: NOW,
    });
    expect(both.value).toBe(90);
    expect(both.reason).toMatch(/Also:/);
  });

  it("ignores postponed/cancelled dates", () => {
    const e = estimateTimeliness({ event: event({ starts_at: hoursFromNow(10), status: "postponed" }), now: NOW });
    expect(e.value).toBeNull();
  });

  it("timely signals add 10 points", () => {
    const e = estimateTimeliness({ trend: trend({ last_seen_at: hoursFromNow(-30), signals: ["breaking"] }), now: NOW });
    expect(e.value).toBe(60);
    expect(e.reason).toMatch(/breaking adds \+10/);
  });

  it("is unknown without dates or trend activity", () => {
    const e = estimateTimeliness({ now: NOW });
    expect(e.value).toBeNull();
    expect(e.reason).toMatch(/unknown/);
  });
});

describe("curiosity", () => {
  it("prefers the radar curiosity score", () => {
    expect(estimateCuriosity({ trend: trend({ curiosity_score: 81 }) }).value).toBe(81);
  });

  it("adds up curiosity signals on a base of 40, capped at 90", () => {
    const e = estimateCuriosity({ trend: trend({ signals: ["upset", "record"] }) });
    expect(e.value).toBe(75);
    expect(e.reason).toMatch(/upset \+20, record \+15/);
    expect(estimateCuriosity({ signals: ["upset", "record", "controversy", "unusual_stat"] }).value).toBe(90);
  });

  it("is left empty without signals", () => {
    expect(estimateCuriosity({ trend: trend({ signals: ["upcoming_event"] }) }).value).toBeNull();
  });
});

describe("originality", () => {
  it("has no heuristic without an angle", () => {
    expect(estimateOriginality({ trend: trend() }).value).toBeNull();
  });

  it("stays empty when the angle repeats the headline", () => {
    const e = estimateOriginality({ trend: trend(), angle: "Bologna beat Inter 3-0" });
    expect(e.value).toBeNull();
    expect(e.reason).toMatch(/repeats the trend headline/);
  });

  it("gives a moderate value when the angle clearly differs from the headline", () => {
    const e = estimateOriginality({ trend: trend(), angle: "How a pressing trap built in training exposed the champions' build-up" });
    expect(e.value).toBe(65);
    expect(e.reason).toMatch(/differs clearly/);
  });

  it("cannot compare without a trend headline", () => {
    expect(estimateOriginality({ angle: "A completely new take" }).value).toBeNull();
  });

  it("measures overlap on significant words only", () => {
    expect(angleOverlap("the Inter collapse", "Inter collapse at home")).toBe(1);
    expect(angleOverlap("tactical breakdown", "Inter collapse")).toBe(0);
  });
});

describe("audience and monetization (sport baselines)", () => {
  it("uses the documented sport baseline", () => {
    const e = estimateAudience({ sport: football });
    expect(e.value).toBe(SPORT_AUDIENCE_BASELINE.football);
    expect(e.reason).toMatch(/Football \(Soccer\) baseline 90/);
  });

  it("adds reach signals", () => {
    const e = estimateAudience({ sport: { slug: "tennis", name: "Tennis" }, signals: ["rivalry"], trend: trend({ publisher_count: 6 }) });
    expect(e.value).toBe(62 + 5 + 5);
  });

  it("does not guess an unknown sport", () => {
    expect(estimateAudience({}).value).toBeNull();
    expect(estimateAudience({ sport: { slug: "padel", name: "Padel" } }).value).toBeNull();
    expect(estimateMonetization({ sport: { slug: "padel", name: "Padel" } }).value).toBeNull();
  });

  it("controversy and injury lower monetization a bit (brand safety)", () => {
    expect(estimateMonetization({ sport: football }).value).toBe(70);
    const e = estimateMonetization({ sport: football, signals: ["controversy", "injury"] });
    expect(e.value).toBe(55);
    expect(e.reason).toMatch(/brand safety/);
  });
});

describe("competition gap", () => {
  it("maps the radar competition level", () => {
    expect(estimateCompetitionGap({ trend: trend({ competition_level: "low" }) }).value).toBe(80);
    expect(estimateCompetitionGap({ trend: trend({ competition_level: "medium" }) }).value).toBe(55);
    expect(estimateCompetitionGap({ trend: trend({ competition_level: "high" }) }).value).toBe(25);
    expect(estimateCompetitionGap({ competitionLevel: "low" }).value).toBe(80);
  });

  it("falls back to publisher count, or nothing", () => {
    const e = estimateCompetitionGap({ trend: trend({ publisher_count: 12 }) });
    expect(e.value).toBe(25);
    expect(e.reason).toMatch(/12 publishers/);
    expect(estimateCompetitionGap({}).value).toBeNull();
  });
});

describe("production feasibility", () => {
  it("starts at 35 without material (original commentary is always possible)", () => {
    const e = estimateProductionFeasibility({ research: { sources: 0, confirmedFacts: 0, timelineItems: 0 } });
    expect(e.value).toBe(35);
    expect(e.reason).toMatch(/starts from scratch/);
  });

  it("grows with sources, confirmed facts and timeline items (capped)", () => {
    const e = estimateProductionFeasibility({ research: { sources: 3, confirmedFacts: 2, timelineItems: 4 } });
    expect(e.value).toBe(35 + 21 + 8 + 10);
    expect(e.reason).toMatch(/3 sources, 2 confirmed facts, 4 timeline items/);
    expect(estimateProductionFeasibility({ research: { sources: 50, confirmedFacts: 50, timelineItems: 50 } }).value).toBe(100);
  });
});

describe("rights safety — STORY ≠ FOOTAGE", () => {
  it("stays high without a production plan: production defaults to original formats", () => {
    const e = estimateRightsSafety({});
    expect(e.value).toBe(85);
    expect(e.reason).toMatch(/original formats/);
  });

  it("stays high with original formats even when linked assets are RED", () => {
    const e = estimateRightsSafety({
      rights: { productionFormats: ["original_commentary", "graphics"], assets: [{ status: "red", usable: false }] },
    });
    expect(e.value).toBe(85);
  });

  it("drops only when the plan depends on RED or unapproved YELLOW material", () => {
    const red = estimateRightsSafety({ rights: { productionFormats: ["licensed_footage"], assets: [{ status: "red", usable: false }] } });
    expect(red.value).toBe(25);
    expect(red.reason).toMatch(/RED material never enters production/);
    const yellow = estimateRightsSafety({ rights: { productionFormats: ["screenshots"], assets: [{ status: "yellow", usable: false }] } });
    expect(yellow.value).toBe(55);
    expect(yellow.reason).toMatch(/awaiting a human rights approval/);
    const approved = estimateRightsSafety({ rights: { productionFormats: ["screenshots"], assets: [{ status: "yellow", usable: true }] } });
    expect(approved.value).toBe(75);
    const green = estimateRightsSafety({ rights: { productionFormats: ["licensed_footage"], assets: [{ status: "green", usable: true }] } });
    expect(green.value).toBe(85);
  });
});

describe("all components", () => {
  it("every estimate carries a plain-language reason", () => {
    const all = estimateComponents({ trend: trend(), sport: football, now: NOW, research: { sources: 2, confirmedFacts: 0, timelineItems: 0 } });
    for (const e of Object.values(all)) {
      expect(e.origin).toBe("heuristic");
      expect(e.reason.length).toBeGreaterThan(15);
    }
    expect(all.originality.value).toBeNull();
  });
});

describe("why now", () => {
  it("is built only from stored timing, coverage and signals", () => {
    const text = buildWhyNow({
      trend: trend({ signals: ["upset"], is_sweet_spot: true }),
      event: { title: "Inter vs Bologna", starts_at: hoursFromNow(-3), ends_at: hoursFromNow(-1), status: "finished" },
      now: NOW,
    });
    expect(text).toBe(
      "Inter vs Bologna finished 1h ago. Trend seen 2h ago across 9 sources from 4 publishers (rising). Flagged as a radar sweet spot. Signals: upset.",
    );
  });

  it("returns null when there is nothing to say", () => {
    expect(buildWhyNow({ now: NOW })).toBeNull();
  });
});
