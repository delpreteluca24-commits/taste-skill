import { z } from "zod";

import { AI_PROVIDER_IDS, AI_TASKS, EFFORTS, type AIProviderId, type AITask, type Effort, type ModelRef, type TaskModelConfig } from "./types";

/**
 * Per-task model routing — AI COST CONTROL.
 *
 * Resolution order for each task (first match wins):
 *   1. Settings → AI → per-task override (saved from the UI)
 *   2. Environment: DISCOVERY_MODEL, SCORING_MODEL, RESEARCH_MODEL, SCRIPT_MODEL, FACT_CHECK_MODEL
 *   3. Code defaults below
 * Values are "provider:model" (e.g. "anthropic:claude-haiku-5-5"); a bare
 * "claude-…" id implies anthropic. AI_FALLBACK_MODEL adds a last-resort fallback.
 *
 * Defaults favour the cheapest model that fits the task: high-volume steps
 * (discovery, scoring) use Haiku; per-story writing and verification use Sonnet.
 * The most expensive models are opt-in per task, never automatic.
 */
export const TASK_ENV_VARS: Record<AITask, string> = {
  discovery: "DISCOVERY_MODEL",
  scoring: "SCORING_MODEL",
  research: "RESEARCH_MODEL",
  script: "SCRIPT_MODEL",
  fact_check: "FACT_CHECK_MODEL",
};

export const TASK_LABELS: Record<AITask, { label: string; description: string; volume: "batch" | "per-item" }> = {
  discovery: { label: "Discovery", description: "Label trends, detect editorial signals", volume: "batch" },
  scoring: { label: "Scoring", description: "Refine opportunity score components", volume: "batch" },
  research: { label: "Research", description: "Research plan, questions, timeline from sources", volume: "per-item" },
  script: { label: "Script", description: "Script angles, hooks, rewrites", volume: "per-item" },
  fact_check: { label: "Fact check", description: "Assess claims against linked sources", volume: "per-item" },
};

export const TASK_DEFAULTS: Record<AITask, { model: ModelRef; effort: Effort; maxOutputTokens: number }> = {
  discovery: { model: { provider: "anthropic", model: "claude-haiku-5-5" }, effort: "low", maxOutputTokens: 4_000 },
  scoring: { model: { provider: "anthropic", model: "claude-haiku-5-5" }, effort: "low", maxOutputTokens: 4_000 },
  research: { model: { provider: "anthropic", model: "claude-sonnet-5-5" }, effort: "medium", maxOutputTokens: 8_000 },
  script: { model: { provider: "anthropic", model: "claude-sonnet-5-5" }, effort: "medium", maxOutputTokens: 12_000 },
  fact_check: { model: { provider: "anthropic", model: "claude-sonnet-5-5" }, effort: "high", maxOutputTokens: 6_000 },
};

const MODEL_ID = /^[A-Za-z0-9._\-/]+$/;

/** "anthropic:claude-haiku-5-5" | "claude-haiku-5-5" | "openai:gpt-x" → ModelRef, or null if invalid. */
export function parseModelRef(value: string | null | undefined): ModelRef | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  let provider: string;
  let model: string;
  if (idx === -1) {
    model = trimmed;
    provider = model.startsWith("claude-") ? "anthropic" : "openai";
  } else {
    provider = trimmed.slice(0, idx).toLowerCase();
    model = trimmed.slice(idx + 1);
  }
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(provider)) return null;
  if (!model || model.length > 100 || !MODEL_ID.test(model)) return null;
  return { provider: provider as AIProviderId, model };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

/** Shape stored in Settings (all optional: unset = fall through to env/default). */
export const taskOverrideSchema = z.object({
  model: z
    .string()
    .trim()
    .max(120)
    .optional()
    .refine((v) => !v || parseModelRef(v) !== null, { message: 'Use "provider:model", e.g. anthropic:claude-haiku-5-5' }),
  fallback: z
    .string()
    .trim()
    .max(120)
    .optional()
    .refine((v) => !v || parseModelRef(v) !== null, { message: 'Use "provider:model"' }),
  effort: z.enum(EFFORTS).optional(),
});
export type TaskOverride = z.infer<typeof taskOverrideSchema>;

export type Env = Record<string, string | undefined>;

export function resolveTaskConfig(task: AITask, override: TaskOverride | undefined, env: Env = process.env): TaskModelConfig {
  const def = TASK_DEFAULTS[task];
  const fromSettings = parseModelRef(override?.model);
  const fromEnv = parseModelRef(env[TASK_ENV_VARS[task]]);
  const primary = fromSettings ?? fromEnv ?? def.model;
  const source: TaskModelConfig["source"] = fromSettings ? "settings" : fromEnv ? "env" : "default";

  const fallbacks: ModelRef[] = [];
  const add = (ref: ModelRef | null) => {
    if (!ref) return;
    const dup = ref.provider === primary.provider && ref.model === primary.model;
    if (!dup && !fallbacks.some((f) => f.provider === ref.provider && f.model === ref.model)) fallbacks.push(ref);
  };
  add(parseModelRef(override?.fallback));
  add(parseModelRef(env.AI_FALLBACK_MODEL));

  return {
    task,
    primary,
    fallbacks,
    effort: override?.effort ?? def.effort,
    maxOutputTokens: def.maxOutputTokens,
    source,
  };
}

export function resolveAllTasks(overrides: Partial<Record<AITask, TaskOverride>> | undefined, env: Env = process.env) {
  return Object.fromEntries(AI_TASKS.map((t) => [t, resolveTaskConfig(t, overrides?.[t], env)])) as Record<
    AITask,
    TaskModelConfig
  >;
}
