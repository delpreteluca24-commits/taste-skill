import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatCountdown, formatDateTime, formatVelocity, hostOf, summarizeDetection } from "@/lib/radar/format";
import {
  dayEndIso,
  dayStartIso,
  eventFormSchema,
  hasRadarFilters,
  isoToLocalInput,
  localInputToIso,
  parseRadarFilters,
  toEventInput,
  tzOffsetMs,
} from "@/lib/radar/schema";
import { eventWindows } from "@/lib/radar/service";

const SPORT = "7a61485a-0c6f-408f-aa5f-afee4f2ca137";

describe("project timezone conversions", () => {
  it("typed wall-clock time → UTC instant, both sides of a DST change", () => {
    // Europe/Rome: UTC+2 in summer (CEST), UTC+1 in winter (CET); DST ends 2026-10-25
    expect(localInputToIso("2026-10-10T20:45", "Europe/Rome")).toBe("2026-10-10T18:45:00.000Z");
    expect(localInputToIso("2026-11-10T20:45", "Europe/Rome")).toBe("2026-11-10T19:45:00.000Z");
    expect(localInputToIso("2026-10-10T20:45", "UTC")).toBe("2026-10-10T20:45:00.000Z");
    expect(localInputToIso("2026-10-10T20:45", "America/New_York")).toBe("2026-10-11T00:45:00.000Z");
  });

  it("rejects malformed values and falls back to UTC for unknown zones", () => {
    expect(localInputToIso("2026-13-10T20:45", "UTC")).toBeNull();
    expect(localInputToIso("10/10/2026 20:45", "UTC")).toBeNull();
    expect(localInputToIso("", "UTC")).toBeNull();
    expect(localInputToIso(null, "UTC")).toBeNull();
    expect(tzOffsetMs(new Date("2026-10-10T00:00:00Z"), "Not/AZone")).toBe(0);
  });

  it("UTC instant → datetime-local value in the project timezone (round trip)", () => {
    expect(isoToLocalInput("2026-10-10T18:45:00.000Z", "Europe/Rome")).toBe("2026-10-10T20:45");
    expect(isoToLocalInput(localInputToIso("2026-12-31T23:30", "Asia/Tokyo"), "Asia/Tokyo")).toBe("2026-12-31T23:30");
    expect(isoToLocalInput(null, "UTC")).toBe("");
    expect(isoToLocalInput("garbage", "UTC")).toBe("");
  });

  it("a filter day spans local midnight to the next local midnight", () => {
    expect(dayStartIso("2026-10-10", "Europe/Rome")).toBe("2026-10-09T22:00:00.000Z");
    expect(dayEndIso("2026-10-10", "Europe/Rome")).toBe("2026-10-10T22:00:00.000Z");
    // the DST day is 25 hours long
    expect(Date.parse(dayEndIso("2026-10-25", "Europe/Rome")!) - Date.parse(dayStartIso("2026-10-25", "Europe/Rome")!)).toBe(25 * 3_600_000);
    expect(dayEndIso("2026-12-31", "UTC")).toBe("2027-01-01T00:00:00.000Z");
    expect(dayStartIso("2026-10-1", "UTC")).toBeNull();
  });
});

describe("radar filters from search params", () => {
  it("keeps valid values and drops the rest", () => {
    expect(
      parseRadarFilters({
        sport: SPORT,
        from: "2026-10-01",
        to: "2026-10-07",
        min: "60",
        trend: "rising",
        competition: "low",
        status: "finished",
      }),
    ).toEqual({ sportId: SPORT, from: "2026-10-01", to: "2026-10-07", minScore: 60, trendStatus: "rising", competition: "low", eventStatus: "finished" });

    expect(parseRadarFilters({ sport: "football", from: "yesterday", min: "abc", trend: "viral", competition: "none", status: "done" })).toEqual({});
    expect(parseRadarFilters({ min: "0" })).toEqual({});
    expect(parseRadarFilters({ min: "101" })).toEqual({});
    expect(parseRadarFilters({ min: ["70", "10"] })).toEqual({ minScore: 70 });
  });

  it("swaps an inverted date range", () => {
    expect(parseRadarFilters({ from: "2026-10-09", to: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  });

  it("knows when any filter is set", () => {
    expect(hasRadarFilters({})).toBe(false);
    expect(hasRadarFilters({ minScore: 50 })).toBe(true);
  });
});

describe("board event windows", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("default: live/upcoming = next 72h, just finished = last 24h", () => {
    expect(eventWindows({}, "UTC", now)).toEqual({
      upcoming: { from: "2026-10-08T12:00:00.000Z", to: "2026-10-11T12:00:00.000Z", custom: false },
      finished: { from: "2026-10-07T12:00:00.000Z", to: "2026-10-08T12:00:00.000Z", custom: false },
    });
  });

  it("a date range replaces them, split at now", () => {
    const w = eventWindows({ from: "2026-10-01", to: "2026-10-20" }, "UTC", now);
    expect(w.upcoming).toEqual({ from: "2026-10-08T12:00:00.000Z", to: "2026-10-21T00:00:00.000Z", custom: true });
    expect(w.finished).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T12:00:00.000Z", custom: true });
    // a range entirely in the past: nothing upcoming can match (from > to)
    const past = eventWindows({ from: "2026-09-01", to: "2026-09-02" }, "UTC", now);
    expect(past.finished.to).toBe("2026-09-03T00:00:00.000Z");
    expect(Date.parse(past.upcoming.from)).toBeGreaterThan(Date.parse(past.upcoming.to));
  });
});

describe("manual event form", () => {
  const base = { title: "Inter vs Bologna", sportId: "", competition: "Serie A", venue: "", description: "", startsAt: "2026-10-10T20:45", endsAt: "", status: "scheduled", importance: "70" };

  it("normalizes empty strings to null and converts times with the project timezone", () => {
    const parsed = eventFormSchema.parse(base);
    expect(parsed).toMatchObject({ sportId: null, venue: null, endsAt: null, importance: 70, status: "scheduled" });
    expect(toEventInput(parsed, "Europe/Rome")).toEqual({
      title: "Inter vs Bologna",
      sport_id: null,
      competition: "Serie A",
      venue: null,
      description: null,
      starts_at: "2026-10-10T18:45:00.000Z",
      ends_at: null,
      status: "scheduled",
      importance: 70,
    });
  });

  it("validates title, sport id, times, status and importance", () => {
    const errors = (over: Record<string, string>) => {
      const r = eventFormSchema.safeParse({ ...base, ...over });
      return r.success ? {} : z.flattenError(r.error).fieldErrors;
    };
    expect(errors({ title: "  " }).title).toBeTruthy();
    expect(errors({ sportId: "football" }).sportId).toBeTruthy();
    expect(errors({ sportId: SPORT })).toEqual({});
    expect(errors({ startsAt: "tomorrow" }).startsAt).toBeTruthy();
    expect(errors({ endsAt: "2026-10-10T19:00" }).endsAt).toEqual(["End must be after the start"]);
    expect(errors({ status: "done" }).status).toBeTruthy();
    expect(errors({ importance: "120" }).importance).toBeTruthy();
    expect(errors({ status: "finished", startsAt: "" }).startsAt).toEqual(["A finished event needs its start time"]);
    expect(eventFormSchema.parse({ ...base, status: undefined }).status).toBe("scheduled");
  });
});

describe("display helpers", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("formats times in the project timezone and relative countdowns", () => {
    expect(formatDateTime("2026-10-08T18:45:00Z", "Europe/Rome")).toBe("Thu 8 Oct, 20:45");
    expect(formatDateTime(null, "UTC")).toBe("—");
    expect(formatCountdown("2026-10-08T15:00:00Z", now)).toBe("in 3h");
    expect(formatCountdown("2026-10-08T11:30:00Z", now)).toBe("30m ago");
    expect(formatCountdown("2026-10-11T12:00:00Z", now)).toBe("in 3d");
  });

  it("hosts and velocity", () => {
    expect(hostOf("https://www.example.com/a")).toBe("example.com");
    expect(hostOf("not a url")).toBe("not a url");
    expect(formatVelocity(0.333)).toBe("+0.33/h");
    expect(formatVelocity(-0.5)).toBe("−0.5/h");
    expect(formatVelocity(null)).toBe("—");
  });

  it("summarizes the last detection from its job result", () => {
    expect(
      summarizeDetection({ sourcesScanned: 42, trendsCreated: 1, trendsUpdated: 5, trendsExpired: 0, sweetSpots: 2, ai: { status: "not_configured", labelled: 0 } }),
    ).toBe("42 sources scanned · 1 new trend · 5 updated · 2 sweet spots · AI titles off (no model configured)");
    expect(summarizeDetection({ skipped: true })).toMatch(/another detection/);
    expect(summarizeDetection(null)).toBeNull();
    expect(summarizeDetection(["x"])).toBeNull();
  });
});
