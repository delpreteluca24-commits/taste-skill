import type { PostgrestError } from "@supabase/supabase-js";

import { TASK_LABELS } from "@/lib/ai/models";
import { AI_TASKS, type AITask } from "@/lib/ai/types";
import type { Db } from "@/lib/db/client";

/**
 * Settings → AI usage: the ai_usage ledger summarised per task and model
 * (rpc ai_usage_summary — SECURITY INVOKER, so RLS limits it to projects the
 * user can read; we also pass the active project id).
 *
 * Cost is shown exactly as stored: a model without a known price has
 * cost_usd = null in the ledger and is shown as "unpriced", never as $0.
 */

export const USAGE_WINDOW_DAYS = 30;

export type AiUsageRow = {
  task: AITask;
  provider: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  /** sum of priced calls; null when no call of this group has a price */
  costUsd: number | null;
};

/**
 * priced   — the ledger has a cost for this group
 * unpriced — tokens were used but the model has no price (cost unknown)
 * none     — no billable tokens (e.g. only requests that failed before a response)
 */
export type CostState = "priced" | "unpriced" | "none";

export type AiUsageLine = AiUsageRow & { taskLabel: string; costState: CostState };

export type AiUsageSummary = {
  days: number;
  lines: AiUsageLine[];
  totals: {
    calls: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    /** priced calls only */
    costUsd: number;
    /** calls in groups whose cost is unknown */
    unpricedCalls: number;
    unpricedModels: string[];
  };
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** RPC rows → typed rows (bigint/numeric may arrive as strings; unknown tasks dropped). */
export function normalizeUsageRows(raw: readonly Record<string, unknown>[]): AiUsageRow[] {
  return raw
    .filter((r) => (AI_TASKS as readonly string[]).includes(String(r.task)))
    .map((r) => ({
      task: r.task as AITask,
      provider: String(r.provider ?? ""),
      model: String(r.model ?? ""),
      calls: num(r.calls),
      errors: num(r.errors),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      costUsd: nullableNum(r.cost_usd),
    }));
}

export function costState(row: Pick<AiUsageRow, "costUsd" | "inputTokens" | "outputTokens">): CostState {
  if (row.costUsd !== null) return "priced";
  return row.inputTokens + row.outputTokens > 0 ? "unpriced" : "none";
}

const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

/** Lines in pipeline task order (discovery → fact check), most expensive model first. */
export function summarizeUsage(rows: readonly AiUsageRow[], days: number = USAGE_WINDOW_DAYS): AiUsageSummary {
  const order = (t: AITask) => AI_TASKS.indexOf(t);
  const lines = [...rows]
    .sort((a, b) => order(a.task) - order(b.task) || (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.calls - a.calls)
    .map((r) => ({ ...r, taskLabel: TASK_LABELS[r.task].label, costState: costState(r) }));

  const unpricedModels = new Set<string>();
  const totals = lines.reduce(
    (acc, l) => {
      acc.calls += l.calls;
      acc.errors += l.errors;
      acc.inputTokens += l.inputTokens;
      acc.outputTokens += l.outputTokens;
      if (l.costUsd !== null) acc.costUsd += l.costUsd;
      if (l.costState === "unpriced") {
        acc.unpricedCalls += l.calls;
        unpricedModels.add(`${l.provider}:${l.model}`);
      }
      return acc;
    },
    { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0 },
  );

  return { days, lines, totals: { ...totals, costUsd: round6(totals.costUsd), unpricedModels: [...unpricedModels].sort() } };
}

/** Loads the summary for one project (user client: RLS applies). */
export async function fetchAiUsageSummary(
  db: Db,
  projectId: string,
  days: number = USAGE_WINDOW_DAYS,
): Promise<{ data: AiUsageSummary; error: null } | { data: null; error: PostgrestError }> {
  const { data, error } = await db.rpc("ai_usage_summary", { p_project_id: projectId, p_days: days });
  if (error) return { data: null, error };
  return { data: summarizeUsage(normalizeUsageRows((data ?? []) as Record<string, unknown>[]), days), error: null };
}
