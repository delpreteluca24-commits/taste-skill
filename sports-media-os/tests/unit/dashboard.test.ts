import { describe, expect, it } from "vitest";

import {
  dailyViewGains,
  formatCount,
  formatDay,
  formatRelative,
  formatScore,
  humanize,
  platformLabel,
  scoreBand,
} from "@/lib/dashboard/format";
import { dashboardSchema } from "@/lib/dashboard/types";

describe("formatters", () => {
  it("formats counts exactly below 10k and compact above", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(12_900)).toBe("12.9K");
    expect(formatCount(4_200_000)).toBe("4.2M");
    expect(formatCount(null)).toBe("—");
  });

  it("keeps missing scores visibly missing", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(91.26)).toBe("91.3");
    expect(formatScore(0)).toBe("0");
  });

  it("bands scores around a threshold", () => {
    expect(scoreBand(80)).toBe("high");
    expect(scoreBand(55)).toBe("medium");
    expect(scoreBand(10)).toBe("low");
    expect(scoreBand(null)).toBe("none");
  });

  it("formats project-local days without timezone drift", () => {
    expect(formatDay("2026-10-08")).toBe("Oct 8");
    expect(formatDay("garbage")).toBe("garbage");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(formatRelative("2026-10-08T11:59:30Z", now)).toBe("just now");
    expect(formatRelative("2026-10-08T11:00:00Z", now)).toBe("1h ago");
    expect(formatRelative("2026-10-06T12:00:00Z", now)).toBe("2d ago");
    expect(formatRelative("2026-10-08T14:00:00Z", now)).toBe("2h from now");
    expect(formatRelative(null, now)).toBe("—");
  });

  it("humanizes enum values and brand names", () => {
    expect(humanize("fact_checker")).toBe("Fact checker");
    expect(["youtube", "tiktok", "instagram"].map(platformLabel)).toEqual(["YouTube", "TikTok", "Instagram"]);
  });
});

describe("dailyViewGains", () => {
  it("converts cumulative views into per-day gains, never negative", () => {
    const gains = dailyViewGains([
      { day: "2026-10-01", published: 1, views: 100 },
      { day: "2026-10-02", published: 0, views: 250 },
      { day: "2026-10-03", published: 2, views: 240 }, // platform correction
      { day: "2026-10-04", published: 0, views: 300 },
    ]);
    expect(gains.map((g) => g.gained)).toEqual([0, 150, 0, 60]);
    expect(gains[2].published).toBe(2);
  });
});

describe("dashboardSchema", () => {
  const base = {
    generated_at: "2026-10-08T10:00:00Z",
    timezone: "Europe/Rome",
    metrics: {
      views: "1500",
      clips_created: 3,
      content_published: 2,
      top_opportunity_score: 91.5,
      avg_virality_score: null,
      production_queue: 4,
    },
    pipeline: { idea: 2, ready: 1 },
    todays_opportunities: [],
    top_opportunities: [
      {
        id: "3f1c4c8e-7a51-4f36-9c55-0f6b2a0c1a11",
        title: "Underdog run",
        status: "new",
        opportunity_score: "88.00",
        competition: "Serie A",
        why_now: "Derby on Sunday",
        created_at: "2026-10-08T09:00:00Z",
      },
    ],
    trending_stories: [],
    content_in_production: [],
    ready_to_publish: [],
    published: [],
    performing_content: [],
    agent_status: [],
    recent_performance: [{ day: "2026-10-08", published: 0, views: 0 }],
  };

  it("parses the RPC payload and coerces numeric strings (Postgres numeric → JSON string)", () => {
    const parsed = dashboardSchema.parse(base);
    expect(parsed.metrics.views).toBe(1500);
    expect(parsed.metrics.avg_virality_score).toBeNull();
    expect(parsed.top_opportunities[0].opportunity_score).toBe(88);
  });

  it("degrades a malformed section to empty instead of failing the page", () => {
    const parsed = dashboardSchema.parse({ ...base, trending_stories: [{ nope: true }] });
    expect(parsed.trending_stories).toEqual([]);
  });
});
