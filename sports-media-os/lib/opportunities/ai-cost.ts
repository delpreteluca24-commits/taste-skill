import { estimateBatchCost, estimateTokens, PRICES_AS_OF } from "@/lib/ai/pricing";
import type { AIRequest, TaskModelConfig } from "@/lib/ai/types";

/**
 * AI COST CONTROL for batch scoring (pure, unit-tested).
 *
 * Before a batch is enqueued we estimate an UPPER BOUND: each call's real prompt
 * (≈ 4 chars per token) plus the task's full output cap, priced for the task's
 * primary model. Above Settings → AI → batch cost limit, or when the model has
 * no known price, the batch runs only after the user confirms the shown estimate.
 */

export type BatchCostEstimate = {
  task: TaskModelConfig["task"];
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  maxOutputTokensPerCall: number;
  /** null = model has no known price (never guessed) */
  usd: number | null;
  limitUsd: number;
  pricesAsOf: string;
};

export function requestInputTokens(request: Pick<AIRequest, "system" | "messages">): number {
  return estimateTokens(request.system) + request.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function estimateRequestsCost(
  requests: Pick<AIRequest, "system" | "messages">[],
  config: TaskModelConfig,
  limitUsd: number,
): BatchCostEstimate {
  const maxOut = config.maxOutputTokens;
  let inputTokens = 0;
  let usd: number | null = 0;
  for (const r of requests) {
    const tokens = requestInputTokens(r);
    inputTokens += tokens;
    const one = estimateBatchCost(config.primary.model, 1, tokens, maxOut);
    usd = one === null || usd === null ? null : usd + one;
  }
  return {
    task: config.task,
    provider: config.primary.provider,
    model: config.primary.model,
    calls: requests.length,
    inputTokens,
    maxOutputTokensPerCall: maxOut,
    usd: usd === null ? null : Math.round(usd * 1_000_000) / 1_000_000,
    limitUsd,
    pricesAsOf: PRICES_AS_OF,
  };
}

export type CostDecision =
  | { allowed: true; confirmed: boolean }
  | { allowed: false; reason: "above_limit" | "unpriced" | "estimate_changed" };

/** the estimate may move by rounding between two requests: allow a tiny tolerance */
const EPSILON = 0.000_001;

/**
 * - within the limit → allowed
 * - above the limit → allowed only if the user confirmed at least this estimate
 * - unpriced model → allowed only after an explicit confirmation (any amount)
 */
export function decideBatchCost(estimate: Pick<BatchCostEstimate, "usd" | "limitUsd">, confirmedCostUsd?: number): CostDecision {
  const confirmed = typeof confirmedCostUsd === "number" && Number.isFinite(confirmedCostUsd) && confirmedCostUsd >= 0;
  if (estimate.usd === null) return confirmed ? { allowed: true, confirmed: true } : { allowed: false, reason: "unpriced" };
  if (estimate.usd <= estimate.limitUsd + EPSILON) return { allowed: true, confirmed: false };
  if (!confirmed || confirmedCostUsd === undefined) return { allowed: false, reason: "above_limit" };
  return confirmedCostUsd + EPSILON >= estimate.usd ? { allowed: true, confirmed: true } : { allowed: false, reason: "estimate_changed" };
}

/** Spending cap the worker enforces while running the batch. */
export function batchBudgetUsd(limitUsd: number, confirmedCostUsd?: number): number {
  return typeof confirmedCostUsd === "number" && confirmedCostUsd > limitUsd ? confirmedCostUsd : limitUsd;
}

export function formatUsd(usd: number | null): string {
  if (usd === null) return "unknown";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
