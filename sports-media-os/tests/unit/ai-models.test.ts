import { afterEach, describe, expect, it } from "vitest";

import { formatModelRef, parseModelRef, resolveAllTasks, resolveTaskConfig, TASK_DEFAULTS } from "@/lib/ai/models";
import { costFor, estimateBatchCost, priceFor, resetPricingOverrides } from "@/lib/ai/pricing";
import { AI_TASKS } from "@/lib/ai/types";
import { aiSettingsSchema } from "@/lib/settings/schema";

describe("model selection per task", () => {
  it("defaults to the cheapest adequate model per task (never the most expensive)", () => {
    const all = resolveAllTasks(undefined, {});
    expect(all.discovery.primary.model).toBe("claude-haiku-5-5");
    expect(all.scoring.primary.model).toBe("claude-haiku-5-5");
    expect(all.research.primary.model).toBe("claude-sonnet-5-5");
    expect(all.script.primary.model).toBe("claude-sonnet-5-5");
    expect(all.fact_check.primary.model).toBe("claude-sonnet-5-5");
    for (const t of AI_TASKS) {
      expect(all[t].primary.model).not.toMatch(/opus|fable/);
      expect(all[t].source).toBe("default");
    }
  });

  it("lets env vars override defaults (DISCOVERY_MODEL … FACT_CHECK_MODEL)", () => {
    const env = { SCRIPT_MODEL: "anthropic:claude-opus-5-5", DISCOVERY_MODEL: "openai:gpt-small" };
    expect(resolveTaskConfig("script", undefined, env)).toMatchObject({
      primary: { provider: "anthropic", model: "claude-opus-5-5" },
      source: "env",
    });
    expect(resolveTaskConfig("discovery", undefined, env).primary).toEqual({ provider: "openai", model: "gpt-small" });
    expect(resolveTaskConfig("scoring", undefined, env).source).toBe("default");
  });

  it("lets Settings override env, per task, with effort and fallback", () => {
    const env = { SCORING_MODEL: "anthropic:claude-sonnet-5-5", AI_FALLBACK_MODEL: "openai:gpt-backup" };
    const cfg = resolveTaskConfig("scoring", { model: "claude-haiku-5-5", effort: "medium", fallback: "anthropic:claude-sonnet-5-5" }, env);
    expect(cfg.source).toBe("settings");
    expect(cfg.primary).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(cfg.effort).toBe("medium");
    expect(cfg.fallbacks).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "openai", model: "gpt-backup" },
    ]);
  });

  it("never lists the primary (or duplicates) as a fallback", () => {
    const cfg = resolveTaskConfig("research", { fallback: "anthropic:claude-sonnet-5-5" }, { AI_FALLBACK_MODEL: "anthropic:claude-sonnet-5-5" });
    expect(cfg.fallbacks).toEqual([]);
  });

  it("parses model references safely", () => {
    expect(parseModelRef("claude-haiku-5-5")).toEqual({ provider: "anthropic", model: "claude-haiku-5-5" });
    expect(parseModelRef("openai:gpt-x")).toEqual({ provider: "openai", model: "gpt-x" });
    expect(parseModelRef("mistral:large")).toBeNull();
    expect(parseModelRef("anthropic:bad id; drop")).toBeNull();
    expect(parseModelRef("")).toBeNull();
    expect(formatModelRef({ provider: "anthropic", model: "claude-sonnet-5-5" })).toBe("anthropic:claude-sonnet-5-5");
  });

  it("validates per-task overrides saved from Settings", () => {
    expect(aiSettingsSchema.parse({})).toEqual({ tasks: {}, batchCostLimitUsd: 1 });
    expect(aiSettingsSchema.safeParse({ tasks: { scoring: { model: "anthropic:claude-haiku-5-5" } } }).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ tasks: { scoring: { model: "evil:model" } } }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ tasks: { unknown_task: {} } }).success).toBe(false);
    // M1-shaped value ({provider, model}) still loads → defaults, no crash
    expect(aiSettingsSchema.parse({ provider: "anthropic", model: "claude-opus-5-5" })).toEqual({ tasks: {}, batchCostLimitUsd: 1 });
  });

  it("keeps output caps per task", () => {
    expect(resolveTaskConfig("script", undefined, {}).maxOutputTokens).toBe(TASK_DEFAULTS.script.maxOutputTokens);
  });
});

describe("pricing", () => {
  afterEach(() => {
    delete process.env.AI_PRICING_JSON;
    resetPricingOverrides();
  });

  it("computes cost from usage including cache tokens", () => {
    // sonnet 5.5: 10k in × $2 + 2k out × $10 + 5k cache read × $0.20  per 1M
    expect(costFor("claude-sonnet-5-5", { inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 5_000, cacheWriteTokens: 0 })).toBe(0.041);
  });

  it("applies Haiku 5.5 long-context pricing above 100k prompt tokens", () => {
    const short = costFor("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const long = costFor("claude-haiku-5-5", { inputTokens: 100_001, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(short).toBeCloseTo(0.01, 6);
    expect(long).toBeCloseTo(0.0500005, 6);
  });

  it("returns null for unpriced models unless configured via AI_PRICING_JSON", () => {
    expect(costFor("gpt-unknown", { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
    process.env.AI_PRICING_JSON = JSON.stringify({ "gpt-unknown": { input: 1, output: 4 } });
    resetPricingOverrides();
    expect(priceFor("gpt-unknown")).toEqual({ input: 1, output: 4 });
    expect(costFor("gpt-unknown", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(5);
  });

  it("estimates batch cost before running (cheap vs expensive model)", () => {
    const haiku = estimateBatchCost("claude-haiku-5-5", 50, 3_000, 800)!;
    const opus = estimateBatchCost("claude-opus-5-5", 50, 3_000, 800)!;
    expect(haiku).toBeCloseTo(0.035, 6);
    expect(opus).toBeCloseTo(1.4, 6);
    expect(opus / haiku).toBeGreaterThan(30);
  });
});
