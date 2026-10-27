import { describe, expect, it, vi } from "vitest";

import { costState, fetchAiUsageSummary, normalizeUsageRows, summarizeUsage, type AiUsageRow } from "@/components/settings/ai-usage";
import type { Db } from "@/lib/db/client";

const row = (over: Partial<AiUsageRow>): AiUsageRow => ({
  task: "scoring",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  calls: 1,
  errors: 0,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  unpricedCalls: 0,
  costUsd: 0.0002,
  ...over,
});

describe("normalizeUsageRows", () => {
  it("coerces bigint/numeric strings, keeps null cost, drops unknown tasks", () => {
    const rows = normalizeUsageRows([
      { task: "script", provider: "anthropic", model: "claude-sonnet-5-5", calls: "3", errors: "1", input_tokens: "15000", output_tokens: 4500, cache_read_tokens: "2048", cache_write_tokens: 512, unpriced_calls: "0", cost_usd: "0.075" },
      { task: "fact_check", provider: "openai", model: "gpt-test", calls: 2, errors: 0, input_tokens: 800, output_tokens: 300, unpriced_calls: 2, cost_usd: null },
      { task: "not_a_task", provider: "x", model: "y", calls: 1, errors: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
    ]);
    expect(rows).toEqual([
      { task: "script", provider: "anthropic", model: "claude-sonnet-5-5", calls: 3, errors: 1, inputTokens: 15000, outputTokens: 4500, cacheReadTokens: 2048, cacheWriteTokens: 512, unpricedCalls: 0, costUsd: 0.075 },
      // older RPC rows without cache columns default to 0
      { task: "fact_check", provider: "openai", model: "gpt-test", calls: 2, errors: 0, inputTokens: 800, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, unpricedCalls: 2, costUsd: null },
    ]);
  });
});

describe("summarizeUsage", () => {
  it("orders lines by pipeline task, then cost, and totals priced calls only", () => {
    const s = summarizeUsage([
      row({ task: "fact_check", model: "claude-sonnet-5-5", calls: 4, costUsd: 0.02 }),
      row({ task: "discovery", calls: 10, errors: 1, inputTokens: 9000, outputTokens: 7000, costUsd: 0.0044 }),
      row({ task: "scoring", calls: 6, costUsd: 0.0018 }),
      row({ task: "scoring", provider: "openai", model: "gpt-test", calls: 2, errors: 2, inputTokens: 500, outputTokens: 100, costUsd: null }),
      row({ task: "scoring", model: "claude-sonnet-5-5", calls: 1, costUsd: 0.006 }),
    ]);
    expect(s.days).toBe(30);
    expect(s.lines.map((l) => `${l.task}:${l.model}`)).toEqual([
      "discovery:claude-haiku-5-5",
      "scoring:claude-sonnet-5-5",
      "scoring:claude-haiku-5-5",
      "scoring:gpt-test",
      "fact_check:claude-sonnet-5-5",
    ]);
    expect(s.lines[0].taskLabel).toBe("Discovery");
    expect(s.lines[4].taskLabel).toBe("Fact check");
    expect(s.totals).toEqual({
      calls: 23,
      errors: 3,
      inputTokens: 9000 + 1000 + 500 + 1000 + 1000,
      outputTokens: 7000 + 200 + 100 + 200 + 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0322, // 0.0044 + 0.006 + 0.0018 + 0.02 — the unpriced group is NOT counted as $0
      unpricedCalls: 2,
      unpricedModels: ["openai:gpt-test"],
    });
    expect(s.lines.find((l) => l.model === "gpt-test")?.costState).toBe("unpriced");
  });

  it("counts the unpriced calls of a mixed group exactly (the priced part stays in the total)", () => {
    const s = summarizeUsage([row({ calls: 5, costUsd: 0.01, unpricedCalls: 2, cacheReadTokens: 300, cacheWriteTokens: 40 })]);
    expect(s.totals).toMatchObject({ costUsd: 0.01, unpricedCalls: 2, unpricedModels: ["anthropic:claude-haiku-5-5"], cacheReadTokens: 300, cacheWriteTokens: 40 });
    expect(s.lines[0].costState).toBe("priced");
  });

  it("returns an empty summary when the ledger has no rows", () => {
    expect(summarizeUsage([], 7)).toEqual({
      days: 7,
      lines: [],
      totals: { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedCalls: 0, unpricedModels: [] },
    });
  });

  it("distinguishes unpriced usage from calls that never produced billable tokens", () => {
    expect(costState({ costUsd: 0.01, inputTokens: 1, outputTokens: 1 })).toBe("priced");
    expect(costState({ costUsd: null, inputTokens: 10, outputTokens: 0 })).toBe("unpriced");
    expect(costState({ costUsd: null, inputTokens: 0, outputTokens: 0 })).toBe("none");
    const s = summarizeUsage([row({ calls: 3, errors: 3, inputTokens: 0, outputTokens: 0, costUsd: null })]);
    expect(s.totals.unpricedCalls).toBe(0);
    expect(s.lines[0].costState).toBe("none");
  });
});

describe("fetchAiUsageSummary", () => {
  it("calls rpc ai_usage_summary for the given project and window", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ task: "research", provider: "anthropic", model: "claude-sonnet-5-5", calls: 2, errors: 0, input_tokens: 3000, output_tokens: 2000, cost_usd: 0.026 }],
      error: null,
    }));
    const res = await fetchAiUsageSummary({ rpc } as unknown as Db, "00000000-0000-4000-8000-0000000000aa", 30);
    expect(rpc).toHaveBeenCalledWith("ai_usage_summary", { p_project_id: "00000000-0000-4000-8000-0000000000aa", p_days: 30 });
    expect(res.error).toBeNull();
    expect(res.data?.totals).toMatchObject({ calls: 2, costUsd: 0.026 });
  });

  it("returns the DB error instead of throwing", async () => {
    const error = { code: "42501", message: "permission denied", details: "", hint: "", name: "PostgrestError" };
    const rpc = vi.fn(async () => ({ data: null, error }));
    const res = await fetchAiUsageSummary({ rpc } as unknown as Db, "00000000-0000-4000-8000-0000000000aa");
    expect(res).toEqual({ data: null, error });
  });
});
