import { describe, expect, it } from "vitest";

import {
  aiScoringRequestSchema,
  componentScoreSchema,
  escapeLike,
  hasFilters,
  manualOpportunitySchema,
  parseOpportunityFilters,
} from "@/lib/opportunities/schema";

const ID = "33333333-3333-4333-8333-333333333333";

describe("list filters from search params", () => {
  it("keeps valid values and drops anything else", () => {
    expect(
      parseOpportunityFilters({ status: "approved", sport: ID, min: "65", sweet: "1", signal: "upset", q: "  Inter  " }),
    ).toEqual({ status: "approved", sportId: ID, minScore: 65, sweetSpot: true, signal: "upset", search: "Inter" });
    const junk = parseOpportunityFilters({ status: "hacked", sport: "1 or 1=1", min: "abc", sweet: "yes", signal: "nope", q: "" });
    expect(junk).toEqual({});
    expect(hasFilters(junk)).toBe(false);
    expect(parseOpportunityFilters({ status: ["new", "approved"] }).status).toBe("new");
  });

  it("escapes LIKE wildcards in search", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});

describe("action inputs", () => {
  it("an empty override value is an error, not 0", () => {
    const r = componentScoreSchema.safeParse({ id: ID, component: "curiosity", value: "", reason: "because" });
    expect(r.success).toBe(false);
    const ok = componentScoreSchema.safeParse({ id: ID, component: "curiosity", value: "0", reason: "because" });
    expect(ok.success && ok.data.value).toBe(0);
  });

  it("overrides need a known component, a 0–100 value and a reason", () => {
    expect(componentScoreSchema.safeParse({ id: ID, component: "virality", value: "50", reason: "because" }).success).toBe(false);
    expect(componentScoreSchema.safeParse({ id: ID, component: "trend", value: "101", reason: "because" }).success).toBe(false);
    expect(componentScoreSchema.safeParse({ id: ID, component: "trend", value: "50", reason: "" }).success).toBe(false);
  });

  it("manual opportunities: title required, empty optional fields become null", () => {
    expect(manualOpportunitySchema.safeParse({ title: "  " }).success).toBe(false);
    const r = manualOpportunitySchema.parse({ title: "Derby day", description: "", why_now: undefined, sportId: "" });
    expect(r).toMatchObject({ title: "Derby day", description: null, why_now: null, sportId: null });
  });

  it("AI scoring takes 1–50 opportunity ids", () => {
    expect(aiScoringRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(aiScoringRequestSchema.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
    expect(aiScoringRequestSchema.safeParse({ ids: Array(51).fill(ID) }).success).toBe(false);
    expect(aiScoringRequestSchema.safeParse({ ids: [ID], confirmedCostUsd: 1.25 }).success).toBe(true);
  });
});
