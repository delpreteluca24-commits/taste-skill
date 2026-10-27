import { describe, expect, it } from "vitest";

import {
  computeOpportunityScore,
  inputsFromRow,
  MIN_COVERAGE,
  SCORE_COMPONENTS,
  scoreToColumns,
  type ScoreComponentKey,
} from "@/lib/scoring/opportunity";

const all = (v: number) =>
  Object.fromEntries(SCORE_COMPONENTS.map((c) => [c.key, { value: v, origin: "heuristic" as const, reason: "test" }])) as Record<
    ScoreComponentKey,
    { value: number; origin: "heuristic"; reason: string }
  >;

describe("opportunity score", () => {
  it("uses the spec weights (sum 100)", () => {
    expect(Object.fromEntries(SCORE_COMPONENTS.map((c) => [c.key, c.weight]))).toEqual({
      trend: 20,
      timeliness: 15,
      curiosity: 15,
      originality: 15,
      audience: 10,
      competition_gap: 10,
      production_feasibility: 5,
      rights_safety: 5,
      monetization: 5,
    });
    expect(SCORE_COMPONENTS.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("is a weighted sum when every component is present", () => {
    const inputs = all(0);
    inputs.trend.value = 100; // 20 pts
    inputs.curiosity.value = 80; // 12 pts
    inputs.rights_safety.value = 60; // 3 pts
    const r = computeOpportunityScore(inputs);
    expect(r.score).toBe(35);
    expect(r.coverage).toBe(100);
    expect(r.complete).toBe(true);
    expect(r.components.find((c) => c.key === "trend")).toMatchObject({ weight: 20, value: 100, contribution: 20 });
  });

  it("bounds the result to 0..100 and clamps out-of-range inputs", () => {
    expect(computeOpportunityScore(all(100)).score).toBe(100);
    expect(computeOpportunityScore(all(0)).score).toBe(0);
    const r = computeOpportunityScore({ ...all(50), trend: { value: 140 }, audience: { value: -20 } });
    expect(r.components.find((c) => c.key === "trend")!.value).toBe(100);
    expect(r.components.find((c) => c.key === "audience")!.value).toBe(0);
    expect(r.score!).toBeGreaterThanOrEqual(0);
    expect(r.score!).toBeLessThanOrEqual(100);
  });

  it("never invents missing components: renormalises and reports coverage", () => {
    const r = computeOpportunityScore({ trend: { value: 80, reason: "rising" }, timeliness: { value: 60, reason: "tonight" } });
    // (80×20 + 60×15) / 35 = 71.43
    expect(r.score).toBe(71.43);
    expect(r.coverage).toBe(35);
    expect(r.incomplete).toBe(true);
    expect(r.missing).toEqual(["curiosity", "originality", "audience", "competition_gap", "production_feasibility", "rights_safety", "monetization"]);
    expect(r.components.find((c) => c.key === "curiosity")).toMatchObject({ value: null, contribution: 0, reason: "Not scored yet" });
    expect(r.summary).toContain("coverage 35%");
  });

  it("is complete enough at the minimum coverage threshold", () => {
    const r = computeOpportunityScore({
      trend: { value: 50 },
      timeliness: { value: 50 },
      curiosity: { value: 50 },
      originality: { value: 50 },
      audience: { value: 50 },
    });
    expect(r.coverage).toBe(75);
    expect(r.coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
    expect(r.incomplete).toBe(false);
  });

  it("returns null (not 0) when nothing is scored", () => {
    const r = computeOpportunityScore({});
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it("explains every component: value, weight, contribution, origin, reason", () => {
    const r = computeOpportunityScore({ ...all(70), curiosity: { value: 90, origin: "ai", reason: "record + upset signals" } });
    const cur = r.components.find((c) => c.key === "curiosity")!;
    expect(cur).toEqual({
      key: "curiosity",
      label: "Curiosity",
      weight: 15,
      value: 90,
      contribution: 13.5,
      origin: "ai",
      reason: "record + upset signals",
    });
    expect(r.components.reduce((s, c) => s + c.contribution, 0)).toBeCloseTo(r.score!, 1);
  });

  it("round-trips through DB columns (store components + total + explanation)", () => {
    const inputs = { ...all(60), monetization: { value: null } };
    const cols = scoreToColumns(inputs);
    expect(cols).toMatchObject({ trend_score: 60, monetization_score: null, scoring_version: "opportunity-v1", score_coverage: 95 });
    const back = inputsFromRow({ ...(cols as Record<string, number>), score_explanation: cols.score_explanation });
    expect(back.trend).toMatchObject({ value: 60, origin: "heuristic", reason: "test" });
    expect(back.monetization?.value).toBeNull();
    expect(computeOpportunityScore(back).score).toBe(cols.opportunity_score);
  });
});
