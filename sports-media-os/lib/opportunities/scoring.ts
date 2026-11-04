import {
  inputsFromRow,
  SCORE_COMPONENTS,
  scoreToColumns,
  type ComponentInput,
  type ScoreColumn,
  type ScoreComponentKey,
} from "@/lib/scoring/opportunity";
import type { Database, Json } from "@/types/database";

import type { Estimates } from "./estimate";

/**
 * Who may overwrite which component (pure, unit-tested):
 *
 *   heuristic → refreshed on every rescore
 *   ai        → replaces heuristic and earlier AI values, NEVER a manual one
 *   manual    → a human decision; only the human can reset it
 */

export type ScoreInputs = Partial<Record<ScoreComponentKey, ComponentInput>>;
export type ScoreNotes = Partial<Record<ScoreComponentKey, string>>;
type OpportunityUpdate = Database["public"]["Tables"]["opportunities"]["Update"];

export const COMPONENT_KEYS = SCORE_COMPONENTS.map((c) => c.key) as ScoreComponentKey[];

export function isComponentKey(value: unknown): value is ScoreComponentKey {
  return typeof value === "string" && (COMPONENT_KEYS as string[]).includes(value);
}

function hasValue(input: ComponentInput | undefined): input is ComponentInput & { value: number } {
  return typeof input?.value === "number" && Number.isFinite(input.value);
}

/**
 * A value without a recorded origin counts as manual, like in lib/scoring
 * (computeOpportunityScore): when in doubt, a human value is never overwritten.
 */
function originOf(input: ComponentInput & { value: number }) {
  return input.origin ?? "manual";
}

/** an AI or manual value survives heuristic rescoring */
function isLocked(input: ComponentInput | undefined) {
  return hasValue(input) && originOf(input) !== "heuristic";
}

/**
 * Heuristics fill every component a human or the AI has not set.
 * Returns the merged inputs and the notes explaining components left empty.
 */
export function mergeHeuristics(current: ScoreInputs, estimates: Estimates): { inputs: ScoreInputs; notes: ScoreNotes } {
  const inputs: ScoreInputs = {};
  const notes: ScoreNotes = {};
  for (const key of COMPONENT_KEYS) {
    const cur = current[key];
    if (isLocked(cur)) {
      inputs[key] = cur;
      continue;
    }
    const e = estimates[key];
    inputs[key] = { value: e.value, origin: "heuristic", reason: e.reason };
    if (e.value === null) notes[key] = e.reason;
  }
  return { inputs, notes };
}

/** A human sets one component (0–100) with a reason. */
export function applyManual(current: ScoreInputs, key: ScoreComponentKey, value: number, reason: string): ScoreInputs {
  return { ...current, [key]: { value: Math.min(100, Math.max(0, value)), origin: "manual", reason: reason.trim() } };
}

/** Drop a manual/AI value so the next heuristic merge recomputes it. */
export function clearComponent(current: ScoreInputs, key: ScoreComponentKey): ScoreInputs {
  return { ...current, [key]: { value: null } };
}

export type AIComponentValue = { component: ScoreComponentKey; value: number; reason: string };

/**
 * Apply AI suggestions: AI replaces heuristic/earlier-AI values and never a
 * manual one. Returns what was applied and what was kept because a human set it.
 */
export function applyAIComponents(
  current: ScoreInputs,
  results: AIComponentValue[],
): { inputs: ScoreInputs; applied: ScoreComponentKey[]; keptManual: ScoreComponentKey[] } {
  const inputs: ScoreInputs = { ...current };
  const applied: ScoreComponentKey[] = [];
  const keptManual: ScoreComponentKey[] = [];
  for (const r of results) {
    const cur = inputs[r.component];
    if (hasValue(cur) && originOf(cur) === "manual") {
      if (!keptManual.includes(r.component)) keptManual.push(r.component);
      continue;
    }
    if (applied.includes(r.component)) continue;
    inputs[r.component] = {
      value: Math.round(Math.min(100, Math.max(0, r.value)) * 100) / 100,
      origin: "ai",
      reason: r.reason.trim(),
    };
    applied.push(r.component);
  }
  return { inputs, applied, keptManual };
}

/** Notes previously stored with the explanation (why a component is still empty). */
export function notesFromExplanation(explanation: unknown): ScoreNotes {
  const raw = (explanation as { notes?: unknown } | null)?.notes;
  if (!raw || typeof raw !== "object") return {};
  const notes: ScoreNotes = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isComponentKey(k) && typeof v === "string") notes[k] = v;
  }
  return notes;
}

/**
 * Score columns for `opportunities` (lib/scoring scoreToColumns) plus the notes
 * that explain empty components, so every number — and every gap — explains itself.
 */
export function buildScoreColumns(inputs: ScoreInputs, notes: ScoreNotes = {}): OpportunityUpdate {
  const cols = scoreToColumns(inputs) as Record<string, unknown>;
  const explanation = cols.score_explanation as Record<string, unknown>;
  const relevant: ScoreNotes = {};
  for (const key of COMPONENT_KEYS) {
    const v = inputs[key]?.value;
    if ((v === null || v === undefined) && notes[key]) relevant[key] = notes[key];
  }
  return { ...cols, score_explanation: { ...explanation, notes: relevant } as Json } as OpportunityUpdate;
}

export type ScoredRow = Partial<Record<ScoreColumn, number | string | null>> & { score_explanation?: unknown };

/** Current inputs + notes of a stored row. */
export function readRow(row: ScoredRow): { inputs: ScoreInputs; notes: ScoreNotes } {
  return { inputs: inputsFromRow(row), notes: notesFromExplanation(row.score_explanation) };
}
