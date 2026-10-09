import { z } from "zod";

import type { FactCheckOutput } from "@/prompts/factcheck/assess";

import type { ClaimRelation, FactStatus } from "./presentation";

/**
 * Sanitising AI output (pure). NEVER INVENT FACTS: the model may only cite
 * sources we gave it, so every id it returns is checked against the provided
 * set and anything else is dropped (and counted, so the drop is visible).
 */

/* ------------------------------------------------------------------------- */
/* shared helpers                                                            */
/* ------------------------------------------------------------------------- */

/** Comparison key for "same text": case, accents, punctuation and spacing ignored. */
export function normaliseForCompare(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Keep only ids from the allowed set, without duplicates; report how many were dropped. */
export function filterKnownIds(ids: readonly string[], allowed: ReadonlySet<string>): { ids: string[]; dropped: number } {
  const out: string[] = [];
  let dropped = 0;
  for (const raw of ids) {
    const id = raw.trim();
    if (!allowed.has(id)) {
      dropped += 1;
      continue;
    }
    if (!out.includes(id)) out.push(id);
  }
  return { ids: out, dropped };
}

/** Collapse whitespace, trim, cap length (never cut mid-meaning: callers drop over-long text instead). */
export function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export function isPhrasedAsQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim());
}

/* ------------------------------------------------------------------------- */
/* fact-check assessment                                                     */
/* ------------------------------------------------------------------------- */

export type FactCheckSuggestion = {
  suggestedStatus: FactStatus;
  confidence: number;
  reasoning: string;
  sources: { sourceId: string; relation: ClaimRelation; note: string | null }[];
  /** set when the requested status was lowered because the model's own relations don't back it */
  adjustment: string | null;
  /** source ids the model returned that were not provided (dropped) */
  droppedSourceIds: number;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Validates an assessment against the sources we provided:
 * - foreign / duplicate source ids are dropped
 * - 'confirmed' needs a source the model itself rates 'supports' and none 'contradicts'
 * - 'false' needs a source it rates 'contradicts'
 * - no usable source at all → 'uncertain'
 * Lowered statuses also cap confidence at 0.5 and say why.
 */
export function sanitiseFactCheck(output: FactCheckOutput, allowedSourceIds: Iterable<string>): FactCheckSuggestion {
  const allowed = new Set(allowedSourceIds);
  const seen = new Set<string>();
  let droppedSourceIds = 0;
  const sources: FactCheckSuggestion["sources"] = [];
  for (const s of output.sources) {
    const id = s.sourceId.trim();
    if (!allowed.has(id)) {
      droppedSourceIds += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const note = cleanText(s.note).slice(0, 400);
    sources.push({ sourceId: id, relation: s.relation, note: note || null });
  }

  const supports = sources.filter((s) => s.relation === "supports").length;
  const contradicts = sources.filter((s) => s.relation === "contradicts").length;

  let status: FactStatus = output.suggestedStatus;
  let adjustment: string | null = null;
  if (sources.length === 0 && status !== "uncertain") {
    adjustment = `Suggested "${status}" without citing any provided source: lowered to uncertain.`;
    status = "uncertain";
  } else if (status === "confirmed" && supports === 0) {
    adjustment = 'Suggested "confirmed" without a supporting source: lowered to uncertain.';
    status = "uncertain";
  } else if (status === "confirmed" && contradicts > 0) {
    adjustment = 'Suggested "confirmed" although a source contradicts the claim: lowered to uncertain.';
    status = "uncertain";
  } else if (status === "false" && contradicts === 0) {
    adjustment = 'Suggested "false" without a contradicting source: lowered to uncertain.';
    status = "uncertain";
  }

  let confidence = Number.isFinite(output.confidence) ? Math.min(1, Math.max(0, output.confidence)) : 0;
  if (adjustment) confidence = Math.min(confidence, 0.5);

  return {
    suggestedStatus: status,
    confidence: round3(confidence),
    reasoning: cleanText(output.reasoning).slice(0, 2000) || "No reasoning given.",
    sources,
    adjustment,
    droppedSourceIds,
  };
}

/* ------------------------------------------------------------------------- */
/* stored suggestion (facts.ai_suggestion)                                   */
/* ------------------------------------------------------------------------- */

export const storedSuggestionSchema = z.object({
  version: z.literal(1),
  suggestedStatus: z.enum(["confirmed", "probable", "uncertain", "false"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(2000),
  sources: z
    .array(
      z.object({
        sourceId: z.string().max(64),
        relation: z.enum(["supports", "contradicts", "mentions"]),
        note: z.string().max(400).nullable(),
      }),
    )
    .max(40),
  adjustment: z.string().max(300).nullable(),
  droppedSourceIds: z.number().int().min(0),
  /** the claim text exactly as assessed */
  claim: z.string().max(2000),
  /** ids of the linked sources the model saw */
  assessedSourceIds: z.array(z.string().max(64)).max(40),
  provider: z.string().max(40),
  model: z.string().max(120),
  promptVersion: z.string().max(60),
  at: z.string().max(40),
  jobId: z.string().max(64).nullable(),
  costUsd: z.number().min(0).nullable(),
});
export type StoredSuggestion = z.infer<typeof storedSuggestionSchema>;

export function buildStoredSuggestion(
  suggestion: FactCheckSuggestion,
  meta: {
    claim: string;
    assessedSourceIds: string[];
    provider: string;
    model: string;
    promptVersion: string;
    at: Date;
    jobId: string | null;
    costUsd: number | null;
  },
): StoredSuggestion {
  return {
    version: 1,
    ...suggestion,
    claim: meta.claim,
    assessedSourceIds: [...new Set(meta.assessedSourceIds)],
    provider: meta.provider,
    model: meta.model,
    promptVersion: meta.promptVersion,
    at: meta.at.toISOString(),
    jobId: meta.jobId,
    costUsd: meta.costUsd,
  };
}

/** facts.ai_suggestion → typed suggestion, or null when absent/unreadable. */
export function readStoredSuggestion(value: unknown): StoredSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const parsed = storedSuggestionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * A suggestion only applies to what was assessed: if the claim text or the set
 * of linked sources changed since, it is stale and cannot be applied.
 * (Relations alone may change: applying the suggested relations is expected.)
 */
export function suggestionStaleReason(
  suggestion: Pick<StoredSuggestion, "claim" | "assessedSourceIds">,
  current: { claim: string; sourceIds: readonly string[] },
): string | null {
  if (normaliseForCompare(suggestion.claim) !== normaliseForCompare(current.claim)) {
    return "The claim was edited after this assessment.";
  }
  const before = new Set(suggestion.assessedSourceIds);
  const now = new Set(current.sourceIds);
  if (before.size !== now.size || [...now].some((id) => !before.has(id))) {
    return "Linked sources changed after this assessment.";
  }
  return null;
}
