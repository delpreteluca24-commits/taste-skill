import { describe, expect, it } from "vitest";

import { escapeLike, hasTrendFilters, parseTrendFilters, trendFilterParams } from "@/lib/trends/schema";
import { publisherOf } from "@/lib/trends/service";

const SPORT = "7a61485a-0c6f-408f-aa5f-afee4f2ca137";

describe("trend list filters", () => {
  it("parses valid search params and ignores invalid ones", () => {
    expect(parseTrendFilters({ q: " Sinner ", status: "rising", competition: "low", sport: SPORT, min: "55", sweet: "1", expired: "1", signal: "upset" })).toEqual({
      search: "Sinner",
      status: "rising",
      competition: "low",
      sportId: SPORT,
      minScore: 55,
      sweetSpot: true,
      includeExpired: true,
      signal: "upset",
    });
    expect(parseTrendFilters({ status: "viral", competition: "x", sport: "tennis", min: "-3", sweet: "yes", signal: "gossip" })).toEqual({});
    expect(parseTrendFilters({ q: "x".repeat(300) }).search).toHaveLength(100);
  });

  it("round-trips through search params (detail links keep the filters)", () => {
    const f = parseTrendFilters({ q: "derby", status: "peaking", min: "40", sweet: "1", signal: "rivalry" });
    expect(parseTrendFilters(Object.fromEntries(trendFilterParams(f)))).toEqual(f);
    expect(hasTrendFilters(f)).toBe(true);
    expect(hasTrendFilters({})).toBe(false);
    expect(trendFilterParams({}).toString()).toBe("");
  });

  it("escapes LIKE wildcards so searches are literal", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});

describe("publisher identity", () => {
  it("is the host without www (two feeds of one outlet = one publisher)", () => {
    expect(publisherOf("https://www.gazzetta.it/calcio/a", "Gazzetta")).toBe("gazzetta.it");
    expect(publisherOf("https://gazzetta.it/rss", "Gazzetta RSS")).toBe("gazzetta.it");
    expect(publisherOf("not a url", " Agency ")).toBe("agency");
  });
});
