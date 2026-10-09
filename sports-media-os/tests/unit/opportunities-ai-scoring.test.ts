import { describe, expect, it, vi } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider, TaskModelConfig } from "@/lib/ai/types";
import { batchBudgetUsd, decideBatchCost, estimateRequestsCost, formatUsd, requestInputTokens } from "@/lib/opportunities/ai-cost";
import {
  applyAIScores,
  buildScoringRequest,
  requestAIScores,
  validateScoringOutput,
  type ScoringRow,
} from "@/lib/opportunities/ai-scoring";
import type { Estimates } from "@/lib/opportunities/estimate";
import { applyAIComponents, applyManual, buildScoreColumns, clearComponent, mergeHeuristics, readRow } from "@/lib/opportunities/scoring";
import { computeOpportunityScore, SCORE_COMPONENTS, type ComponentExplanation } from "@/lib/scoring/opportunity";

/* ------------------------------------------------------------------------- */
/* fixtures                                                                  */
/* ------------------------------------------------------------------------- */

const heuristic = (value: number | null, reason = "heuristic reason") => ({ value, origin: "heuristic" as const, reason });

function estimates(over: Partial<Estimates> = {}): Estimates {
  return {
    trend: heuristic(70),
    timeliness: heuristic(80),
    curiosity: heuristic(50),
    originality: heuristic(null, "No angle yet"),
    audience: heuristic(90),
    competition_gap: heuristic(55),
    production_feasibility: heuristic(35),
    rights_safety: heuristic(85),
    monetization: heuristic(70),
    ...over,
  };
}

/** a stored row as the DB would hold it after scoreToColumns */
function row(over: Partial<ScoringRow> = {}, origins: Partial<Record<string, "heuristic" | "ai" | "manual">> = {}): ScoringRow {
  const inputs = Object.fromEntries(
    SCORE_COMPONENTS.map((c) => [c.key, { value: 50, origin: origins[c.key] ?? "heuristic", reason: `${c.key} reason` }]),
  );
  const cols = buildScoreColumns(inputs);
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Bologna beat Inter 3-0 at San Siro",
    description: null,
    why_now: "Finished 2h ago.",
    angle: "The pressing trap that broke Inter",
    hook: null,
    competition: "Serie A",
    signals: ["upset"],
    competition_level: "medium",
    trend_score: cols.trend_score ?? null,
    timeliness_score: cols.timeliness_score ?? null,
    curiosity_score: cols.curiosity_score ?? null,
    originality_score: cols.originality_score ?? null,
    audience_score: cols.audience_score ?? null,
    competition_gap_score: cols.competition_gap_score ?? null,
    production_feasibility_score: cols.production_feasibility_score ?? null,
    rights_score: cols.rights_score ?? null,
    monetization_score: cols.monetization_score ?? null,
    score_explanation: cols.score_explanation ?? null,
    ...over,
  };
}

const SOURCE = { id: "22222222-2222-4222-8222-222222222222", title: "Bologna stun Inter", publisher: "Agency" };
const usage = { inputTokens: 900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };

function config(over: Partial<TaskModelConfig> = {}): TaskModelConfig {
  return {
    task: "scoring",
    primary: { provider: "anthropic", model: "claude-haiku-5-5" },
    fallbacks: [],
    effort: "low",
    maxOutputTokens: 4000,
    source: "default",
    ...over,
  };
}

function fakeRouter(output: unknown) {
  const complete = vi.fn(
    async (): Promise<AICallResult> => ({ text: JSON.stringify(output), usage, servedModel: "claude-haiku-5-5", latencyMs: 5, stopReason: "end_turn" }),
  );
  const provider: AIProvider = { id: "anthropic", isConfigured: () => true, complete };
  const router = createAIRouter({ providers: { anthropic: provider }, resolveConfig: () => config() });
  return { router, complete };
}

const explanationOf = (cols: ReturnType<typeof buildScoreColumns>) =>
  (cols.score_explanation as { components: ComponentExplanation[]; notes: Record<string, string> });

/* ------------------------------------------------------------------------- */
/* merge rules                                                               */
/* ------------------------------------------------------------------------- */

describe("score merge rules", () => {
  it("heuristics fill empty components and keep AI and manual values", () => {
    const current = {
      curiosity: { value: 90, origin: "manual" as const, reason: "editor call" },
      audience: { value: 40, origin: "ai" as const, reason: "AI view" },
      trend: { value: 10, origin: "heuristic" as const, reason: "old" },
    };
    const { inputs, notes } = mergeHeuristics(current, estimates());
    expect(inputs.curiosity).toEqual(current.curiosity);
    expect(inputs.audience).toEqual(current.audience);
    expect(inputs.trend).toMatchObject({ value: 70, origin: "heuristic" });
    expect(inputs.originality?.value).toBeNull();
    expect(notes.originality).toBe("No angle yet");
  });

  it("a value without a recorded origin counts as manual (never overwritten)", () => {
    const { inputs } = mergeHeuristics({ trend: { value: 12 } }, estimates());
    expect(inputs.trend?.value).toBe(12);
  });

  it("manual set / reset", () => {
    const set = applyManual({}, "rights_safety", 140, "  licensed via club  ");
    expect(set.rights_safety).toEqual({ value: 100, origin: "manual", reason: "licensed via club" });
    const cleared = clearComponent(set, "rights_safety");
    expect(mergeHeuristics(cleared, estimates()).inputs.rights_safety).toMatchObject({ value: 85, origin: "heuristic" });
  });

  it("AI replaces heuristic and earlier AI values but NEVER a manual one", () => {
    const current = {
      curiosity: { value: 90, origin: "manual" as const, reason: "editor call" },
      audience: { value: 40, origin: "ai" as const, reason: "old AI" },
      monetization: { value: 70, origin: "heuristic" as const, reason: "baseline" },
    };
    const res = applyAIComponents(current, [
      { component: "curiosity", value: 20, reason: "AI thinks low" },
      { component: "audience", value: 77.777, reason: "new AI" },
      { component: "monetization", value: 60, reason: "brand risk" },
    ]);
    expect(res.inputs.curiosity).toEqual(current.curiosity);
    expect(res.keptManual).toEqual(["curiosity"]);
    expect(res.applied).toEqual(["audience", "monetization"]);
    expect(res.inputs.audience).toEqual({ value: 77.78, origin: "ai", reason: "new AI" });
  });

  it("stores notes only for components that are still empty", () => {
    const cols = buildScoreColumns({ trend: heuristic(70), originality: heuristic(null) }, { trend: "x", originality: "why empty" });
    expect(explanationOf(cols).notes).toEqual({ originality: "why empty" });
    expect(cols.trend_score).toBe(70);
    expect(cols.opportunity_score).toBe(70);
    expect(cols.score_coverage).toBe(20);
  });
});

/* ------------------------------------------------------------------------- */
/* AI scoring with a fake router                                             */
/* ------------------------------------------------------------------------- */

describe("AI scoring (fake router, no real calls)", () => {
  it("sends only provided fields + source titles and applies values with origin 'ai'", async () => {
    const { router, complete } = fakeRouter({
      components: [
        { component: "curiosity", value: 82, reason: "An upset at San Siro is surprising.", source_ids: [SOURCE.id] },
        { component: "originality", value: 70, reason: "Tactical angle differs from the result headline." },
      ],
    });
    const r = row();
    const res = await requestAIScores(router, r, { sportName: "Football (Soccer)", sources: [SOURCE] });
    expect(res).not.toBeNull();
    expect(res!.accepted.map((a) => a.component)).toEqual(["curiosity", "originality"]);
    expect(res!.costUsd).toBeCloseTo((900 * 0.1 + 300 * 0.5) / 1_000_000, 8);

    const [, request] = complete.mock.calls[0] as unknown as [string, { system: string; messages: { content: string }[]; cacheSystemPrompt: boolean }];
    expect(request.cacheSystemPrompt).toBe(true);
    expect(request.messages[0].content).toContain(SOURCE.title);
    expect(request.messages[0].content).toContain(SOURCE.id);
    expect(request.system).toMatch(/Do not add results, names, numbers/);

    const applied = applyAIScores(r, res!.accepted);
    expect(applied.applied).toEqual(["curiosity", "originality"]);
    const comps = explanationOf(applied.columns).components;
    expect(comps.find((c) => c.key === "curiosity")).toMatchObject({ value: 82, origin: "ai" });
    expect(applied.columns.curiosity_score).toBe(82);
    // the total is recomputed from all components
    const expected = computeOpportunityScore(readRow({ ...r, ...applied.columns } as ScoringRow).inputs).score;
    expect(applied.columns.opportunity_score).toBe(expected);
  });

  it("never overrides a manual component, and does not even ask for it", async () => {
    const r = row({}, { curiosity: "manual", audience: "manual" });
    const { router, complete } = fakeRouter({
      components: [
        { component: "curiosity", value: 5, reason: "ignored" },
        { component: "monetization", value: 66, reason: "fine" },
      ],
    });
    const res = await requestAIScores(router, r, { sportName: null, sources: [] });
    const sent = JSON.parse(((complete.mock.calls[0] as unknown as [string, { messages: { content: string }[] }])[1].messages[0].content.split("<data>")[1]).split("</data>")[0]);
    expect(sent.do_not_score).toEqual(["curiosity", "audience"]);
    expect(res!.rejected).toEqual([{ component: "curiosity", code: "manual", why: "set manually by a human" }]);

    const applied = applyAIScores(r, res!.accepted);
    expect(applied.columns.curiosity_score).toBe(50);
    expect(applied.columns.monetization_score).toBe(66);
    expect(explanationOf(applied.columns).components.find((c) => c.key === "curiosity")?.origin).toBe("manual");
  });

  it("a manual change made during the call still wins (applied onto the fresh row)", () => {
    const fresh = row({}, { originality: "manual" });
    const applied = applyAIScores(fresh, [{ component: "originality", value: 10, reason: "AI" }]);
    expect(applied.keptManual).toEqual(["originality"]);
    expect(applied.columns.originality_score).toBe(50);
  });

  it("skips the call entirely when every AI component is manual (no cost)", async () => {
    const r = row({}, { curiosity: "manual", originality: "manual", audience: "manual", monetization: "manual" });
    const { router, complete } = fakeRouter({ components: [] });
    expect(await requestAIScores(router, r, { sportName: null, sources: [] })).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects components citing sources that were not provided, and duplicates", () => {
    const res = validateScoringOutput(
      {
        components: [
          { component: "audience", value: 80, reason: "cites invented article", source_ids: ["made-up"] },
          { component: "curiosity", value: 60, reason: "ok", source_ids: [SOURCE.id] },
          { component: "curiosity", value: 99, reason: "dup" },
        ],
      },
      { sourceIds: [SOURCE.id], doNotScore: [] },
    );
    expect(res.accepted).toEqual([{ component: "curiosity", value: 60, reason: "ok" }]);
    expect(res.rejected.map((r) => [r.component, r.code])).toEqual([
      ["audience", "unknown_source"],
      ["curiosity", "duplicate"],
    ]);
    expect(res.rejected[0].why).toMatch(/not provided/);
  });

  it("invalid model output never reaches the score (router validation)", async () => {
    const { router } = fakeRouter({ components: [{ component: "trend", value: 100, reason: "not allowed" }] });
    await expect(requestAIScores(router, row(), { sportName: null, sources: [] })).rejects.toMatchObject({ name: "AIError" });
  });
});

/* ------------------------------------------------------------------------- */
/* cost estimate & confirmation                                              */
/* ------------------------------------------------------------------------- */

describe("batch cost control", () => {
  const request = buildScoringRequest(row(), { sportName: "Football (Soccer)", sources: [SOURCE] }).request;

  it("estimates an upper bound: real prompt tokens + full output cap, primary model price", () => {
    const tokens = requestInputTokens(request);
    expect(tokens).toBeGreaterThan(300);
    const est = estimateRequestsCost([request, request], config(), 1);
    expect(est).toMatchObject({ calls: 2, model: "claude-haiku-5-5", maxOutputTokensPerCall: 4000, limitUsd: 1 });
    expect(est.inputTokens).toBe(tokens * 2);
    expect(est.usd).toBeCloseTo((2 * (tokens * 0.1 + 4000 * 0.5)) / 1_000_000, 6);
  });

  it("unpriced models have no estimate (never guessed)", () => {
    const est = estimateRequestsCost([request], config({ primary: { provider: "openai", model: "gpt-unpriced" } }), 1);
    expect(est.usd).toBeNull();
    expect(formatUsd(est.usd)).toBe("unknown");
  });

  it("runs within the limit, asks for confirmation above it", () => {
    expect(decideBatchCost({ usd: 0.5, limitUsd: 1 })).toEqual({ allowed: true, confirmed: false });
    expect(decideBatchCost({ usd: 1.5, limitUsd: 1 })).toEqual({ allowed: false, reason: "above_limit" });
    expect(decideBatchCost({ usd: 1.5, limitUsd: 1 }, 1.5)).toEqual({ allowed: true, confirmed: true });
    expect(decideBatchCost({ usd: 1.5, limitUsd: 1 }, 2)).toEqual({ allowed: true, confirmed: true });
  });

  it("a confirmation of a lower, outdated estimate is not enough", () => {
    expect(decideBatchCost({ usd: 2.5, limitUsd: 1 }, 1.2)).toEqual({ allowed: false, reason: "estimate_changed" });
  });

  it("unpriced models always need an explicit confirmation", () => {
    expect(decideBatchCost({ usd: null, limitUsd: 1 })).toEqual({ allowed: false, reason: "unpriced" });
    expect(decideBatchCost({ usd: null, limitUsd: 1 }, 0)).toEqual({ allowed: true, confirmed: true });
  });

  it("the worker budget is the limit, or the higher amount the user confirmed", () => {
    expect(batchBudgetUsd(1)).toBe(1);
    expect(batchBudgetUsd(1, 3.2)).toBe(3.2);
    expect(batchBudgetUsd(1, 0)).toBe(1);
  });
});
