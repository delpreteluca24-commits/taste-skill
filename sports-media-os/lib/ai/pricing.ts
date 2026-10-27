import type { AIUsage } from "./types";

/**
 * USD per 1M tokens. Anthropic prices from the official model table
 * (cached 2026-10-06, re-check before relying on them for budgets).
 * Models not listed (e.g. OpenAI) are UNPRICED until configured via the
 * AI_PRICING_JSON env var — the ledger then stores cost = null, never a guess.
 */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** some models change tier above a prompt size */
  longContext?: { aboveInputTokens: number; input: number; output: number };
};

export const PRICES_AS_OF = "2026-10-06";

const BUILT_IN: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longContext: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 },
  },
};

let overrides: Record<string, ModelPrice> | null = null;

function loadOverrides(): Record<string, ModelPrice> {
  if (overrides) return overrides;
  overrides = {};
  const raw = process.env.AI_PRICING_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, ModelPrice>;
      for (const [model, p] of Object.entries(parsed)) {
        if (typeof p?.input === "number" && typeof p?.output === "number") overrides[model] = p;
      }
    } catch {
      // invalid JSON → ignore overrides; costs stay null for unknown models
    }
  }
  return overrides;
}

/** test hook */
export function resetPricingOverrides() {
  overrides = null;
}

export function priceFor(model: string): ModelPrice | null {
  return loadOverrides()[model] ?? BUILT_IN[model] ?? null;
}

/** Cost of one call in USD (6 decimals), or null when the model is unpriced. */
export function costFor(model: string, usage: AIUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = p.longContext && promptTokens > p.longContext.aboveInputTokens ? p.longContext : null;
  const inputRate = long?.input ?? p.input;
  const outputRate = long?.output ?? p.output;
  const usd =
    (usage.inputTokens * inputRate +
      usage.outputTokens * outputRate +
      usage.cacheReadTokens * (p.cacheRead ?? inputRate) +
      usage.cacheWriteTokens * (p.cacheWrite ?? inputRate)) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Rough token estimate for budgeting before a call (≈ 4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Upper-bound cost estimate for N calls of a given prompt size and output cap. */
export function estimateBatchCost(model: string, calls: number, inputTokensPerCall: number, maxOutputTokensPerCall: number) {
  const perCall = costFor(model, {
    inputTokens: inputTokensPerCall,
    outputTokens: maxOutputTokensPerCall,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  return perCall === null ? null : Math.round(perCall * calls * 1_000_000) / 1_000_000;
}
