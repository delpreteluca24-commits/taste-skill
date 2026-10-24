import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TYPICAL_CALL } from "@/components/settings/ai-routing";
import {
  BENCHMARK_SPECS,
  benchmarkReportName,
  estimateModels,
  parseFixtureFile,
  percentile,
  recommendModel,
  renderEstimateMarkdown,
  renderRunMarkdown,
  resolveBenchmarkOptions,
  runBenchmarkCalls,
  summarizeModelRuns,
  totalUpperBound,
  type BenchmarkCase,
  type CallRecord,
} from "@/components/settings/benchmark";
import { costFor, resetPricingOverrides } from "@/lib/ai/pricing";
import { AI_TASKS, AIError, type AICallResult, type AIProvider, type AIRequest, type AITask, type ModelRef } from "@/lib/ai/types";
import { buildOpportunityScoringMessages, OPPORTUNITY_SCORING_SYSTEM } from "@/prompts/scoring/opportunity";

const fixturePath = (task: AITask) => new URL(`../fixtures/ai/${task}.json`, import.meta.url);
const loadFixture = (task: AITask): unknown => JSON.parse(readFileSync(fixturePath(task), "utf8"));

const haiku: ModelRef = { provider: "anthropic", model: "claude-haiku-5-5" };
const sonnet: ModelRef = { provider: "anthropic", model: "claude-sonnet-5-5" };
const opus: ModelRef = { provider: "anthropic", model: "claude-opus-5-5" };
const unpriced: ModelRef = { provider: "openai", model: "gpt-test" };

beforeEach(() => {
  delete process.env.AI_PRICING_JSON;
  resetPricingOverrides();
});

function walk(value: unknown, visit: (key: string, v: unknown) => void, key = "") {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  else visit(key, value);
}

describe("fixtures (tests/fixtures/ai/<task>.json)", () => {
  it.each(AI_TASKS)("%s: parses against the production prompt input and is clearly fictional", (task) => {
    const raw = loadFixture(task) as { fixture: boolean; notice: string };
    expect(raw.fixture).toBe(true);
    expect(raw.notice).toMatch(/INVENTED/);
    const cases = parseFixtureFile(task, raw);
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const c of cases) {
      expect(c.request.system).toBe(BENCHMARK_SPECS[task].system);
      expect(c.request.messages[0].content).toContain("<data>");
    }
    walk(raw, (key, v) => {
      if (key === "url") expect(String(v)).toMatch(/^https:\/\/example\.test\//);
      if (key === "publisher" && v !== null) expect(String(v)).toMatch(/\(fixture\)$/);
    });
  });

  it("builds the exact request the worker sends (real prompt builder)", () => {
    const raw = loadFixture("scoring") as { cases: { input: Parameters<typeof buildOpportunityScoringMessages>[0] }[] };
    const [first] = parseFixtureFile("scoring", raw);
    expect(first.request).toEqual({ system: OPPORTUNITY_SCORING_SYSTEM, messages: buildOpportunityScoringMessages(raw.cases[0].input) });
  });

  it("rejects files for another task, without the fixture flag, with duplicate ids or bad inputs", () => {
    const scoring = loadFixture("scoring") as { cases: { id: string; input: unknown }[] };
    expect(() => parseFixtureFile("research", scoring)).toThrow(/for "scoring", not "research"/);
    expect(() => parseFixtureFile("scoring", { ...scoring, fixture: false })).toThrow(/Invalid fixture file/);
    expect(() => parseFixtureFile("scoring", { ...scoring, cases: [scoring.cases[0], scoring.cases[0]] })).toThrow(/Duplicate fixture case id/);
    expect(() =>
      parseFixtureFile("scoring", { ...scoring, cases: [{ id: "bad", input: { opportunity: { title: "x" }, sources: [], doNotScore: [] } }] }),
    ).toThrow(/does not match the scoring prompt input/);
  });
});

function syntheticCase(systemChars: number, messageChars: number): BenchmarkCase {
  return {
    id: "synthetic",
    description: null,
    input: null,
    request: { system: "s".repeat(systemChars), messages: [{ role: "user", content: "m".repeat(messageChars) }] },
  };
}

describe("estimateModels (dry run)", () => {
  it("prices typical, cached and upper-bound cost per model and compares to the cheapest", () => {
    // system 1,000 tokens + message 100 tokens; scoring: typical output 450, cap 4,000
    const cases = [syntheticCase(4000, 400)];
    const [h, s, u] = estimateModels("scoring", cases, [haiku, sonnet, unpriced], 2);
    expect(TYPICAL_CALL.scoring.outputTokens).toBe(450);

    expect(h).toMatchObject({ model: "anthropic:claude-haiku-5-5", priced: true, calls: 2, inputTokens: 2200, typicalOutputTokens: 900, maxOutputTokens: 8000 });
    expect(h.typicalUsd).toBeCloseTo(2 * ((1100 * 0.1 + 450 * 0.5) / 1e6), 9); // 0.00067
    expect(h.upperBoundUsd).toBeCloseTo(2 * ((1100 * 0.1 + 4000 * 0.5) / 1e6), 9); // 0.00422
    // first call writes the system prompt to the cache ($0.125/M), the second reads it ($0.01/M)
    expect(h.cachedUsd).toBeCloseTo((100 * 0.1 + 1000 * 0.125 + 450 * 0.5 + (100 * 0.1 + 1000 * 0.01 + 450 * 0.5)) / 1e6, 9);
    expect(h.per100CallsUsd).toBeCloseTo(0.0335, 6);
    expect(h.vsCheapest).toBe(1);

    expect(s.typicalUsd).toBeCloseTo(2 * ((1100 * 2 + 450 * 10) / 1e6), 9);
    expect(s.vsCheapest).toBe(20);

    expect(u).toMatchObject({ priced: false, typicalUsd: null, cachedUsd: null, upperBoundUsd: null, per100CallsUsd: null, vsCheapest: null });
    expect(totalUpperBound([h, s])).toBeCloseTo((h.upperBoundUsd as number) + (s.upperBoundUsd as number), 6);
    expect(totalUpperBound([h, u])).toBeNull();
  });

  it("does not assume caching for system prompts below the cacheable minimum", () => {
    const [h] = estimateModels("scoring", [syntheticCase(400, 400), syntheticCase(400, 400)], [haiku]);
    expect(h.cachedUsd).toBe(h.typicalUsd);
  });

  it("works on the real fixtures without any API key", () => {
    const cases = parseFixtureFile("discovery", loadFixture("discovery"));
    const rows = estimateModels("discovery", cases, [haiku, opus]);
    expect(rows[1].vsCheapest).toBe(40);
    expect(renderEstimateMarkdown({ date: "2026-10-09", task: "discovery", fixtureFile: "tests/fixtures/ai/discovery.json", cases: cases.length, repeat: 1, effort: "low" }, rows)).toMatch(
      /dry run, no API calls[\s\S]*`anthropic:claude-opus-5-5`.*×40/,
    );
  });
});

describe("resolveBenchmarkOptions", () => {
  it("defaults to a dry run comparing Haiku and Sonnet at the task's effort", () => {
    const res = resolveBenchmarkOptions({ task: "scoring" });
    expect(res).toEqual({
      ok: true,
      options: { task: "scoring", models: [haiku, sonnet], run: false, write: false, limit: null, repeat: 1, effort: "low", maxUsd: 1 },
    });
  });

  it("parses models (deduplicated) and numeric flags", () => {
    const res = resolveBenchmarkOptions({
      task: "fact_check",
      models: "claude-haiku-5-5, anthropic:claude-haiku-5-5,anthropic:claude-opus-5-5",
      run: true,
      limit: "2",
      repeat: "3",
      effort: "medium",
      "max-usd": "0.25",
    });
    expect(res).toEqual({
      ok: true,
      options: { task: "fact_check", models: [haiku, opus], run: true, write: false, limit: 2, repeat: 3, effort: "medium", maxUsd: 0.25 },
    });
  });

  it.each([
    [{}, /--task is required/],
    [{ task: "publishing" }, /--task is required/],
    [{ task: "scoring", models: "mistral:large" }, /Invalid model/],
    [{ task: "scoring", models: " , " }, /at least one/],
    [{ task: "scoring", limit: "0" }, /--limit/],
    [{ task: "scoring", repeat: "1.5" }, /--repeat/],
    [{ task: "scoring", effort: "turbo" }, /--effort/],
    [{ task: "scoring", "max-usd": "-1" }, /--max-usd/],
  ])("rejects %j", (raw, message) => {
    const res = resolveBenchmarkOptions(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(message);
  });
});

describe("grounding check (ids the model returns must be ids we provided)", () => {
  it("discovery: a label may only cite headlines of its own cluster", () => {
    const input = { clusters: [{ key: "c1", headlines: [{ id: "h1", title: "A", publisher: null }] }, { key: "c2", headlines: [{ id: "h2", title: "B", publisher: null }] }] };
    const unknown = BENCHMARK_SPECS.discovery.unknownIds(input, {
      labels: [
        { cluster: "c1", title: "Ok", source_ids: ["h1"] },
        { cluster: "c2", title: "Cross", source_ids: ["h1"] },
        { cluster: "c9", title: "Invented", source_ids: ["h2"] },
      ],
    });
    expect(unknown).toEqual(["h1", "c9"]);
  });

  it("script: facts_used and quote_ids must be in the (limited) context", () => {
    const [c] = parseFixtureFile("script", loadFixture("script"));
    const input = c.input as { context: { facts: { id: string }[]; quotes: { id: string }[] } };
    const ok = { hook: "h", context: "c", escalation: "e", reveal: "r", payoff: "p", cta: "c", facts_used: [input.context.facts[0].id], quote_ids: [input.context.quotes[0].id], missing: [] };
    expect(BENCHMARK_SPECS.script.unknownIds(c.input, ok)).toEqual([]);
    expect(BENCHMARK_SPECS.script.unknownIds(c.input, { ...ok, facts_used: ["fact-from-memory"] })).toEqual(["fact-from-memory"]);
  });

  it("research and fact check: every cited source id must be provided", () => {
    const [r] = parseFixtureFile("research", loadFixture("research"));
    expect(
      BENCHMARK_SPECS.research.unknownIds(r.input, { questions: [], claims: [{ claim: "x", sourceIds: ["nope"], isCritical: true }], timeline: [], context: [] }),
    ).toEqual(["nope"]);
    const [f] = parseFixtureFile("fact_check", loadFixture("fact_check"));
    const sid = (f.input as { sources: { id: string }[] }).sources[0].id;
    expect(BENCHMARK_SPECS.fact_check.unknownIds(f.input, { suggestedStatus: "confirmed", confidence: 0.9, reasoning: "r", sources: [{ sourceId: sid, relation: "supports", note: null }] })).toEqual([]);
  });
});

describe("runBenchmarkCalls (fake providers through createAIRouter)", () => {
  const usage = { inputTokens: 700, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const reply = (text: string, servedModel: string): AICallResult => ({ text, usage, servedModel, latencyMs: 25, stopReason: "end_turn" });

  it("measures each model with a single-model chain: valid, invalid output, ungrounded ids and errors", async () => {
    const cases = parseFixtureFile("scoring", loadFixture("scoring")).slice(0, 2);
    const firstSource = (cases[0].input as { sources: { id: string }[] }).sources[0].id;
    const complete = vi.fn(async (model: string, request: AIRequest): Promise<AICallResult> => {
      void request;
      if (model === "claude-haiku-5-5") {
        return reply(JSON.stringify({ components: [{ component: "curiosity", value: 70, reason: "Clear tension in the title.", source_ids: [firstSource] }] }), model);
      }
      if (model === "claude-sonnet-5-5") {
        return reply(JSON.stringify({ components: [{ component: "curiosity", value: 80, reason: "r", source_ids: ["invented-id"] }] }), model);
      }
      if (model === "claude-opus-5-5") return reply('{"components": [{"component": "curiosity", "value": 400}]}', model);
      throw new AIError("overloaded", "down", { provider: "anthropic", model });
    });
    const anthropic: AIProvider = { id: "anthropic", isConfigured: () => true, complete };
    const progress = vi.fn();

    const records = await runBenchmarkCalls({
      task: "scoring",
      cases,
      models: [haiku, sonnet, opus, { provider: "anthropic", model: "claude-fable-5-1" }],
      providers: { anthropic },
      effort: "low",
      onRecord: progress,
    });

    // 4 models × 2 cases, one call each: no fallback ever runs
    expect(complete).toHaveBeenCalledTimes(8);
    expect(progress).toHaveBeenCalledTimes(8);
    const [model, request] = complete.mock.calls[0];
    expect(model).toBe("claude-haiku-5-5");
    expect(request).toMatchObject({ system: OPPORTUNITY_SCORING_SYSTEM, cacheSystemPrompt: true, effort: "low", maxOutputTokens: 4000 });

    const byModel = (m: string) => records.filter((r) => r.model === m);
    // case 1 cites a provided id; case 2 cites case 1's id (not provided there) → flagged
    expect(byModel("anthropic:claude-haiku-5-5").map((r) => [r.status, r.unknownIds])).toEqual([
      ["ok", []],
      ["ok", [firstSource]],
    ]);
    expect(byModel("anthropic:claude-haiku-5-5")[0]).toMatchObject({ inputTokens: 700, outputTokens: 300, latencyMs: 25, costUsd: costFor("claude-haiku-5-5", usage) });
    expect(byModel("anthropic:claude-sonnet-5-5").every((r) => r.status === "ok" && r.unknownIds[0] === "invented-id")).toBe(true);
    expect(byModel("anthropic:claude-opus-5-5").map((r) => [r.status, r.errorKind])).toEqual([
      ["invalid_output", "invalid_output"],
      ["invalid_output", "invalid_output"],
    ]);
    // tokens of an output that failed the schema are still recorded (they were billed)
    expect(byModel("anthropic:claude-opus-5-5")[0].costUsd).toBe(costFor("claude-opus-5-5", usage));
    expect(byModel("anthropic:claude-fable-5-1").map((r) => [r.status, r.errorKind, r.costUsd])).toEqual([
      ["error", "overloaded", null],
      ["error", "overloaded", null],
    ]);
  });
});

describe("run summaries, recommendation and report", () => {
  const rec = (over: Partial<CallRecord>): CallRecord => ({
    caseId: "c",
    model: "anthropic:claude-haiku-5-5",
    status: "ok",
    errorKind: null,
    latencyMs: 1000,
    inputTokens: 700,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.0002,
    unknownIds: [],
    ...over,
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("summarises validity, grounding, latency, tokens and cost per model", () => {
    const records = [
      rec({ latencyMs: 800 }),
      rec({ latencyMs: 1200, unknownIds: ["x"] }),
      rec({ status: "invalid_output", errorKind: "invalid_output", latencyMs: 1000 }),
      rec({ status: "error", errorKind: "rate_limited", inputTokens: 0, outputTokens: 0, costUsd: null, latencyMs: 5 }),
      rec({ model: "openai:gpt-test", costUsd: null }),
    ];
    const s = summarizeModelRuns("anthropic:claude-haiku-5-5", records);
    expect(s).toMatchObject({
      calls: 4,
      ok: 2,
      invalidOutput: 1,
      errors: 1,
      errorKinds: { invalid_output: 1, rate_limited: 1 },
      latencyAvgMs: 1000,
      latencyP50Ms: 1000,
      avgInputTokens: 700,
      avgOutputTokens: 300,
      unpricedCalls: 0,
    });
    expect(s.schemaValidRate).toBeCloseTo(2 / 3, 6);
    expect(s.idsValidRate).toBe(0.5);
    expect(s.totalCostUsd).toBeCloseTo(0.0006, 9);
    expect(s.per100CallsUsd).toBeCloseTo(0.015, 9);
    expect(summarizeModelRuns("openai:gpt-test", records)).toMatchObject({ totalCostUsd: null, per100CallsUsd: null, unpricedCalls: 1 });
  });

  it("recommends the cheapest model that is schema-valid and grounded, else none", () => {
    const good = (model: string, cost: number) => summarizeModelRuns(model, [rec({ model, costUsd: cost })]);
    const cheapBad = summarizeModelRuns("anthropic:claude-haiku-5-5", [rec({ unknownIds: ["x"] })]);
    const mid = good("anthropic:claude-sonnet-5-5", 0.004);
    const pricey = good("anthropic:claude-opus-5-5", 0.008);
    expect(recommendModel([pricey, cheapBad, mid])?.model).toBe("anthropic:claude-sonnet-5-5");
    expect(recommendModel([cheapBad])).toBeNull();
  });

  it("renders a report with the measurements, the suggestion and an empty decision", () => {
    const records = [rec({}), rec({ model: "anthropic:claude-sonnet-5-5", costUsd: 0.004, unknownIds: ["invented"] })];
    const summaries = ["anthropic:claude-haiku-5-5", "anthropic:claude-sonnet-5-5"].map((m) => summarizeModelRuns(m, records));
    const cases = parseFixtureFile("scoring", loadFixture("scoring"));
    const estimates = estimateModels("scoring", cases, [haiku, sonnet]);
    const md = renderRunMarkdown({ date: "2026-10-09", task: "scoring", fixtureFile: "tests/fixtures/ai/scoring.json", cases: 6, repeat: 1, effort: "low" }, estimates, summaries, records);
    expect(md).toContain("# AI benchmark: scoring (2026-10-09)");
    expect(md).toContain("prompt `opportunity-scoring-v1`");
    expect(md).toContain("clearly fictional");
    expect(md).toMatch(/`anthropic:claude-haiku-5-5` is the cheapest model with ≥ 95%/);
    expect(md).toMatch(/\| c \| `anthropic:claude-sonnet-5-5` \| ok \| — \| invented \|/);
    expect(md).toContain("## Decision");
    expect(benchmarkReportName("2026-10-09", "scoring", "run")).toBe("2026-10-09-scoring.md");
    expect(benchmarkReportName("2026-10-09", "scoring", "estimate")).toBe("2026-10-09-scoring-estimate.md");
  });
});
