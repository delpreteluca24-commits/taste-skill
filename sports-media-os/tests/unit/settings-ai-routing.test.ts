import { beforeEach, describe, expect, it } from "vitest";

import { formatCost, formatPricePerMillion, formatTokens, sourceLabel } from "@/components/settings/ai-format";
import { costForCalls, modelSuggestions, presentAllTaskRouting, presentTaskRouting, TYPICAL_CALL } from "@/components/settings/ai-routing";
import { resetPricingOverrides } from "@/lib/ai/pricing";
import { AI_TASKS } from "@/lib/ai/types";
import { SUGGESTED_MODELS } from "@/lib/settings/schema";

const keys = { anthropic: true, openai: false };

beforeEach(() => {
  delete process.env.AI_PRICING_JSON;
  resetPricingOverrides();
});

describe("presentTaskRouting — effective model and its source", () => {
  it("shows the code default (Haiku for scoring) with price and indicative cost", () => {
    const v = presentTaskRouting("scoring", undefined, {}, keys);
    expect(v).toMatchObject({
      task: "scoring",
      label: "Scoring",
      volume: "batch",
      envVar: "SCORING_MODEL",
      model: "anthropic:claude-haiku-5-5",
      source: "default",
      inheritedModel: "anthropic:claude-haiku-5-5",
      inheritedSource: "default",
      fallbacks: [],
      effort: "low",
      effortSource: "default",
      maxOutputTokens: 4_000,
      providerConfigured: true,
      price: { input: 0.1, output: 0.5 },
      costVsDefault: null,
      needsBenchmark: false,
      override: { model: "", fallback: "", effort: "" },
    });
    // 100 × (700 in × $0.10 + 450 out × $0.50) / 1M = $0.0295
    expect(v.costPer100Calls).toBeCloseTo(0.0295, 6);
    expect(v.typical).toEqual(TYPICAL_CALL.scoring);
  });

  it("uses the env var when set and flags a pricier model on a batch task", () => {
    const v = presentTaskRouting("scoring", undefined, { SCORING_MODEL: "anthropic:claude-sonnet-5-5" }, keys);
    expect(v.source).toBe("env");
    expect(v.inheritedSource).toBe("env");
    expect(v.model).toBe("anthropic:claude-sonnet-5-5");
    // 100 × (700 × $2 + 450 × $10) / 1M = $0.59 → 20× Haiku
    expect(v.costPer100Calls).toBeCloseTo(0.59, 6);
    expect(v.costVsDefault).toBe(20);
    expect(v.needsBenchmark).toBe(true);
  });

  it("Settings win over env; the placeholder shows what an empty field would inherit", () => {
    const v = presentTaskRouting("scoring", { model: "anthropic:claude-haiku-5-5", effort: "medium" }, { SCORING_MODEL: "anthropic:claude-sonnet-5-5" }, keys);
    expect(v.source).toBe("settings");
    expect(v.model).toBe("anthropic:claude-haiku-5-5");
    expect(v.inheritedModel).toBe("anthropic:claude-sonnet-5-5");
    expect(v.inheritedSource).toBe("env");
    expect(v.effort).toBe("medium");
    expect(v.effortSource).toBe("settings");
    expect(v.override).toEqual({ model: "anthropic:claude-haiku-5-5", fallback: "", effort: "medium" });
    expect(v.needsBenchmark).toBe(false);
  });

  it("does not warn for a pricier model on a per-item task, but shows the ratio", () => {
    const v = presentTaskRouting("research", { model: "anthropic:claude-opus-5-5" }, {}, keys);
    expect(v.volume).toBe("per-item");
    expect(v.costVsDefault).toBe(2); // Opus 5.5 is 2× Sonnet 5.5 per token
    expect(v.needsBenchmark).toBe(false);
  });

  it("shows an unpriced model as unpriced (null), never as a guessed cost", () => {
    const v = presentTaskRouting("discovery", { model: "openai:gpt-test" }, {}, keys);
    expect(v.price).toBeNull();
    expect(v.costPer100Calls).toBeNull();
    expect(v.costVsDefault).toBeNull();
    expect(v.needsBenchmark).toBe(true);
    expect(v.providerConfigured).toBe(false); // no OpenAI key → the router skips it
  });

  it("builds the fallback chain: task fallback, then AI_FALLBACK_MODEL, without duplicates of the primary", () => {
    const v = presentTaskRouting(
      "script",
      { fallback: "openai:gpt-test" },
      { AI_FALLBACK_MODEL: "anthropic:claude-haiku-5-5", SCRIPT_MODEL: "" },
      keys,
    );
    expect(v.model).toBe("anthropic:claude-sonnet-5-5");
    expect(v.fallbacks).toEqual(["openai:gpt-test", "anthropic:claude-haiku-5-5"]);
    const same = presentTaskRouting("script", { fallback: "anthropic:claude-sonnet-5-5" }, {}, keys);
    expect(same.fallbacks).toEqual([]);
  });

  it("never carries env values other than model ids (no API keys)", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-secret-value", OPENAI_API_KEY: "sk-openai-secret", SCORING_MODEL: "anthropic:claude-sonnet-5-5" };
    const views = presentAllTaskRouting({}, env, keys);
    const json = JSON.stringify(views);
    expect(json).not.toContain("secret");
    expect(views.map((v) => v.task)).toEqual([...AI_TASKS]);
  });

  it("respects AI_PRICING_JSON prices for otherwise unpriced models", () => {
    process.env.AI_PRICING_JSON = JSON.stringify({ "gpt-test": { input: 1, output: 4 } });
    resetPricingOverrides();
    const v = presentTaskRouting("discovery", { model: "openai:gpt-test" }, {}, keys);
    expect(v.price).toEqual({ input: 1, output: 4 });
    // 100 × (900 × $1 + 700 × $4) / 1M = $0.37
    expect(v.costPer100Calls).toBeCloseTo(0.37, 6);
  });
});

describe("cost helpers and formatting", () => {
  it("costForCalls scales linearly and returns null when unpriced", () => {
    expect(costForCalls("claude-haiku-5-5", 1, { inputTokens: 100_000, outputTokens: 0 })).toBe(0.01);
    // above 100K prompt tokens Haiku 5.5 bills the long-context tier ($0.50 / 1M in)
    expect(costForCalls("claude-haiku-5-5", 1, { inputTokens: 200_000, outputTokens: 0 })).toBe(0.1);
    expect(costForCalls("claude-sonnet-5-5", 10, { inputTokens: 1000, outputTokens: 1000 })).toBeCloseTo(0.12, 6);
    expect(costForCalls("unknown-model", 100, { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });

  it("formats costs, prices, sources and token counts", () => {
    expect(formatCost(null)).toBe("unpriced");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.00004)).toBe("<$0.0001");
    expect(formatCost(0.005)).toBe("$0.0050");
    expect(formatCost(0.0295)).toBe("$0.03");
    expect(formatCost(12.345)).toBe("$12.35");
    expect(formatPricePerMillion({ input: 0.1, output: 0.5 })).toBe("$0.10 / $0.50");
    expect(formatPricePerMillion({ input: 4, output: 20 })).toBe("$4 / $20");
    expect(sourceLabel("settings", "SCRIPT_MODEL")).toBe("Settings");
    expect(sourceLabel("env", "SCRIPT_MODEL")).toBe("Env · SCRIPT_MODEL");
    expect(sourceLabel("default", "SCRIPT_MODEL")).toBe("Default");
    expect(formatTokens(1234567)).toBe("1,234,567");
  });

  it("labels datalist suggestions with their price, cheapest first", () => {
    const s = modelSuggestions(SUGGESTED_MODELS);
    expect(s[0]).toEqual({ value: "anthropic:claude-haiku-5-5", label: "$0.10 / $0.50 per 1M tokens (in / out)" });
    expect(s.find((x) => x.value === "anthropic:claude-opus-5-5")?.label).toBe("$4 / $20 per 1M tokens (in / out)");
    expect(modelSuggestions(["openai:gpt-test"])[0].label).toBe("unpriced");
  });
});
