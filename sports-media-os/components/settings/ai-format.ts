import type { AITask, TaskModelConfig } from "@/lib/ai/types";

/**
 * Formatting + form-field helpers for Settings → AI. Dependency-free (type
 * imports only) so the client form can use them without pulling pricing/env code.
 */

/** Form field names: tasks.<task>.model | fallback | effort */
export const TASK_FIELDS = ["model", "fallback", "effort"] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

export function taskFieldName(task: AITask, field: TaskField): string {
  return `tasks.${task}.${field}`;
}

/** USD per 1M tokens */
export type PriceView = { input: number; output: number };

/** Cost in USD; null → "unpriced" (never a guessed number). */
export function formatCost(usd: number | null): string {
  if (usd === null) return "unpriced";
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatRate(v: number): string {
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

/** "$0.10 / $0.50" (input / output, USD per 1M tokens) */
export function formatPricePerMillion(price: PriceView): string {
  return `${formatRate(price.input)} / ${formatRate(price.output)}`;
}

export function sourceLabel(source: TaskModelConfig["source"], envVar: string): string {
  if (source === "settings") return "Settings";
  if (source === "env") return `Env · ${envVar}`;
  return "Default";
}

const integer = new Intl.NumberFormat("en-US");

export function formatTokens(n: number): string {
  return integer.format(n);
}
