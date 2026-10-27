import type { z } from "zod";

import {
  formatModelRef,
  parseModelRef,
  resolveTaskConfig,
  TASK_DEFAULTS,
  TASK_ENV_VARS,
  TASK_LABELS,
  type Env,
  type TaskOverride,
} from "@/lib/ai/models";
import { costFor, priceFor } from "@/lib/ai/pricing";
import { AI_TASKS, EFFORTS, type AIProviderId, type AITask, type Effort, type TaskModelConfig } from "@/lib/ai/types";

import { formatPricePerMillion, TASK_FIELDS, taskFieldName, type PriceView, type TaskField } from "./ai-format";

/**
 * Settings → AI: per-task routing (pure helpers, unit-tested).
 *
 * The page resolves the EFFECTIVE routing on the server (Settings > env >
 * default, see lib/ai/models.ts) and hands the client form plain view objects:
 * model ids, sources, prices and estimates — never env values other than model
 * ids, never API keys.
 */

/**
 * Typical call per task, used for the indicative "cost per 100 calls".
 * Input = average of the real prompt (system + data block) over the benchmark
 * fixtures (`npm run ai:benchmark -- --task <task>`, ≈ 4 chars per token,
 * measured 2026-10-09); output is an ASSUMPTION that includes adaptive-thinking
 * tokens at the task's default effort. Indicative only: the ai_usage ledger
 * holds the real numbers.
 */
export const TYPICAL_CALL: Record<AITask, { inputTokens: number; outputTokens: number }> = {
  discovery: { inputTokens: 900, outputTokens: 700 },
  scoring: { inputTokens: 700, outputTokens: 450 },
  research: { inputTokens: 900, outputTokens: 1_400 },
  script: { inputTokens: 1_400, outputTokens: 1_100 },
  fact_check: { inputTokens: 650, outputTokens: 550 },
};

/** A batch task whose model costs this many times the default gets a "benchmark first" warning. */
export const BATCH_COST_WARNING_RATIO = 1.5;

/**
 * Reads the AI section of the settings form into the shape aiSettingsSchema
 * validates. Empty fields are OMITTED (= inherit env/default); a task with no
 * field set is omitted entirely. Valid model refs are normalised to
 * "provider:model" (e.g. "claude-haiku-5-5" → "anthropic:claude-haiku-5-5");
 * invalid ones are passed through unchanged so the schema rejects them.
 * An empty batch limit is omitted too (schema default, $1 — never 0/unlimited).
 */
export function readAiSettingsForm(formData: FormData): Record<string, unknown> {
  const tasks: Partial<Record<AITask, Partial<Record<TaskField, string>>>> = {};
  for (const task of AI_TASKS) {
    const entry: Partial<Record<TaskField, string>> = {};
    for (const field of TASK_FIELDS) {
      const raw = formData.get(taskFieldName(task, field));
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value) continue;
      entry[field] = field === "effort" ? value : normaliseModelInput(value);
    }
    if (Object.keys(entry).length > 0) tasks[task] = entry;
  }

  const limit = formData.get("batchCostLimitUsd");
  const limitValue = typeof limit === "string" ? limit.trim() : "";
  return { tasks, ...(limitValue ? { batchCostLimitUsd: limitValue } : {}) };
}

function normaliseModelInput(value: string): string {
  const ref = parseModelRef(value);
  return ref ? formatModelRef(ref) : value;
}

/**
 * Zod issues keyed by their dotted path ("tasks.scoring.model"), so nested
 * fields get their own message. For flat schemas the keys equal z.flattenError's.
 */
export function fieldErrorsByPath(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Plain-language messages for the AI section (model messages already are). */
export function friendlyAiFieldErrors(errors: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) {
    if (key === "batchCostLimitUsd") out[key] = ["Enter an amount in USD between 0 and 1000."];
    else if (key.endsWith(".effort")) out[key] = [`Choose an effort level: ${EFFORTS.join(", ")} (or inherit).`];
    else out[key] = messages;
  }
  return out;
}

// ─── Presentation ───────────────────────────────────────────────────────────

export type TaskRoutingView = {
  task: AITask;
  label: string;
  description: string;
  volume: "batch" | "per-item";
  envVar: string;
  /** effective primary, "provider:model" */
  model: string;
  source: TaskModelConfig["source"];
  /** what an empty override inherits (env or code default) */
  inheritedModel: string;
  inheritedSource: "env" | "default";
  defaultModel: string;
  /** effective fallback chain after the primary (task fallback, then AI_FALLBACK_MODEL) */
  fallbacks: string[];
  effort: Effort;
  defaultEffort: Effort;
  effortSource: "settings" | "default";
  maxOutputTokens: number;
  /** false when the primary's provider has no API key: the router skips it */
  providerConfigured: boolean;
  /** USD per 1M tokens; null = unpriced (cost stored as null, never guessed) */
  price: PriceView | null;
  typical: { inputTokens: number; outputTokens: number };
  costPer100Calls: number | null;
  defaultCostPer100Calls: number | null;
  /** effective ÷ default cost per call, only when the model differs and both are priced */
  costVsDefault: number | null;
  /** batch task on a model costing ≥ BATCH_COST_WARNING_RATIO × the default, or unpriced */
  needsBenchmark: boolean;
  /** stored override values (form default values) */
  override: { model: string; fallback: string; effort: string };
};

/** Cost of N calls of a given token profile (no prompt caching), or null when unpriced. */
export function costForCalls(model: string, calls: number, profile: { inputTokens: number; outputTokens: number }): number | null {
  const one = costFor(model, { inputTokens: profile.inputTokens, outputTokens: profile.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
  return one === null ? null : Math.round(one * calls * 1_000_000) / 1_000_000;
}

export function priceView(model: string): PriceView | null {
  const p = priceFor(model);
  return p ? { input: p.input, output: p.output } : null;
}

export function presentTaskRouting(
  task: AITask,
  override: TaskOverride | undefined,
  env: Env,
  configured: Partial<Record<AIProviderId, boolean>>,
): TaskRoutingView {
  const cfg = resolveTaskConfig(task, override, env);
  const inherited = resolveTaskConfig(task, { ...override, model: undefined }, env);
  const def = TASK_DEFAULTS[task];
  const meta = TASK_LABELS[task];
  const typical = TYPICAL_CALL[task];

  const model = formatModelRef(cfg.primary);
  const defaultModel = formatModelRef(def.model);
  const costPer100Calls = costForCalls(cfg.primary.model, 100, typical);
  const defaultCostPer100Calls = costForCalls(def.model.model, 100, typical);
  const costVsDefault =
    model !== defaultModel && costPer100Calls !== null && defaultCostPer100Calls
      ? Math.round((costPer100Calls / defaultCostPer100Calls) * 10) / 10
      : null;

  return {
    task,
    label: meta.label,
    description: meta.description,
    volume: meta.volume,
    envVar: TASK_ENV_VARS[task],
    model,
    source: cfg.source,
    inheritedModel: formatModelRef(inherited.primary),
    inheritedSource: inherited.source === "env" ? "env" : "default",
    defaultModel,
    fallbacks: cfg.fallbacks.map(formatModelRef),
    effort: cfg.effort,
    defaultEffort: def.effort,
    effortSource: override?.effort ? "settings" : "default",
    maxOutputTokens: cfg.maxOutputTokens,
    providerConfigured: Boolean(configured[cfg.primary.provider]),
    price: priceView(cfg.primary.model),
    typical,
    costPer100Calls,
    defaultCostPer100Calls,
    costVsDefault,
    needsBenchmark:
      meta.volume === "batch" &&
      model !== defaultModel &&
      (costPer100Calls === null || (costVsDefault !== null && costVsDefault >= BATCH_COST_WARNING_RATIO)),
    override: { model: override?.model ?? "", fallback: override?.fallback ?? "", effort: override?.effort ?? "" },
  };
}

export function presentAllTaskRouting(
  overrides: Partial<Record<AITask, TaskOverride>> | undefined,
  env: Env,
  configured: Partial<Record<AIProviderId, boolean>>,
): TaskRoutingView[] {
  return AI_TASKS.map((task) => presentTaskRouting(task, overrides?.[task], env, configured));
}

export type ModelSuggestion = { value: string; label: string };

/** Datalist options: "provider:model" with its price, cheapest first. */
export function modelSuggestions(models: readonly string[]): ModelSuggestion[] {
  return models.map((value) => {
    const ref = parseModelRef(value);
    const price = ref ? priceView(ref.model) : null;
    return { value, label: price ? `${formatPricePerMillion(price)} per 1M tokens (in / out)` : "unpriced" };
  });
}
