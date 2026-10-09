import type { Enums } from "@/lib/db/client";

import type { ScriptSections } from "./schema";
import { SCRIPT_SECTIONS } from "./schema";
import { clip, extractNumbers, extractQuotations, normalizeForMatch, numberSet } from "./text";

/**
 * GROUNDING — NEVER INVENT FACTS.
 *
 * Every AI script (and every manual edit) is checked against the research it
 * was written from before it is stored. Nothing is rewritten silently: the
 * version keeps the text, and `scripts.warnings` says what a reviewer must
 * check before approving it.
 *
 *   - facts_used ⊆ provided fact ids (others dropped + warning)
 *   - every number in the text appears in some provided fact claim
 *   - used facts that are not 'confirmed' are listed (must stay attributed)
 *   - text in quotation marks matches a saved quote (research quote item)
 *   - what the model said is missing is kept as a to-do for the researcher
 *
 * Warnings are stored as "kind: message" strings (text[] column); parseWarning
 * turns them back into structured values for the UI.
 */

export const WARNING_KINDS = [
  "unknown_fact",
  "ungrounded_number",
  "unconfirmed_fact",
  "unbacked_quote",
  "unknown_quote",
  "no_facts",
  "empty_section",
  "missing_info",
] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];
export type ScriptWarning = { kind: WarningKind | "note"; message: string };

export const WARNING_LABELS: Record<ScriptWarning["kind"], { label: string; severity: "danger" | "warning" | "info" }> = {
  unknown_fact: { label: "Unknown fact reference", severity: "danger" },
  ungrounded_number: { label: "Number not in facts", severity: "danger" },
  unbacked_quote: { label: "Quote not in research", severity: "danger" },
  unknown_quote: { label: "Unknown quote reference", severity: "warning" },
  unconfirmed_fact: { label: "Unconfirmed facts", severity: "warning" },
  no_facts: { label: "No facts used", severity: "warning" },
  empty_section: { label: "Empty section", severity: "warning" },
  missing_info: { label: "Missing information", severity: "info" },
  note: { label: "Note", severity: "info" },
};

export function formatWarning(w: ScriptWarning): string {
  return `${w.kind}: ${w.message}`;
}

export function parseWarning(value: string): ScriptWarning {
  const m = /^([a-z_]+):\s*([\s\S]*)$/.exec(value);
  if (m && (WARNING_KINDS as readonly string[]).includes(m[1])) return { kind: m[1] as WarningKind, message: m[2] };
  if (m && m[1] === "note") return { kind: "note", message: m[2] };
  return { kind: "note", message: value };
}

export type GroundingFact = { id: string; claim: string; status: Enums<"fact_status"> };
export type GroundingQuote = { id: string; text: string; speaker: string | null };

export type GroundingInput = {
  sections: ScriptSections;
  /** fact ids the model says it used */
  factIds: readonly string[];
  /** quote ids the model says it used */
  quoteIds?: readonly string[];
  /** what the model says is missing from the research */
  missing?: readonly string[];
  facts: readonly GroundingFact[];
  quotes: readonly GroundingQuote[];
};

export type GroundingResult = {
  factsUsed: string[];
  quoteIdsUsed: string[];
  warnings: string[];
  /** structured counts for job results and tests */
  checks: {
    droppedFactIds: string[];
    droppedQuoteIds: string[];
    ungroundedNumbers: string[];
    unconfirmedFactIds: string[];
    unbackedQuotes: string[];
  };
};

export const MAX_WARNINGS = 20;
const MAX_LISTED = 6;

/** The full text of a version, sections in reading order. */
export function composeFullText(sections: ScriptSections): string {
  return SCRIPT_SECTIONS.map((s) => sections[s.key].trim())
    .filter(Boolean)
    .join("\n\n");
}

export function groundScript(input: GroundingInput): GroundingResult {
  const warnings: ScriptWarning[] = [];
  const factById = new Map(input.facts.map((f) => [f.id, f]));
  const quoteIds = new Set(input.quotes.map((q) => q.id));

  // 1. fact ids must be ones we provided
  const factsUsed: string[] = [];
  const droppedFactIds: string[] = [];
  for (const id of input.factIds) {
    if (factById.has(id)) {
      if (!factsUsed.includes(id)) factsUsed.push(id);
    } else if (!droppedFactIds.includes(id)) droppedFactIds.push(id);
  }
  if (droppedFactIds.length) {
    warnings.push({
      kind: "unknown_fact",
      message: `Removed ${droppedFactIds.length} fact reference(s) that were not in the provided research. Check that every statement comes from a listed fact.`,
    });
  }

  const quoteIdsUsed: string[] = [];
  const droppedQuoteIds: string[] = [];
  for (const id of input.quoteIds ?? []) {
    if (quoteIds.has(id)) {
      if (!quoteIdsUsed.includes(id)) quoteIdsUsed.push(id);
    } else if (!droppedQuoteIds.includes(id)) droppedQuoteIds.push(id);
  }
  if (droppedQuoteIds.length) {
    warnings.push({ kind: "unknown_quote", message: `Removed ${droppedQuoteIds.length} quote reference(s) that were not in the research.` });
  }

  const text = composeFullText(input.sections);

  // 2. numbers only from fact claims (any provided fact, not only the ones cited)
  const allowed = numberSet(input.facts.map((f) => f.claim));
  const ungroundedNumbers = extractNumbers(text).filter((n) => !allowed.has(n));
  if (ungroundedNumbers.length) {
    const listed = ungroundedNumbers.slice(0, MAX_LISTED).map((n) => `“${n}”`).join(", ");
    const more = ungroundedNumbers.length > MAX_LISTED ? ` and ${ungroundedNumbers.length - MAX_LISTED} more` : "";
    warnings.push({
      kind: "ungrounded_number",
      message: `${listed}${more} ${ungroundedNumbers.length === 1 ? "is" : "are"} not in any provided fact. Verify and add the fact in Research, or remove the number.`,
    });
  }

  // 3. facts used that are not confirmed must stay attributed / hedged
  const unconfirmed = factsUsed.map((id) => factById.get(id)!).filter((f) => f.status !== "confirmed");
  if (unconfirmed.length) {
    const listed = unconfirmed
      .slice(0, 3)
      .map((f) => `“${clip(f.claim, 80)}” (${f.status})`)
      .join("; ");
    warnings.push({
      kind: "unconfirmed_fact",
      message: `Uses ${unconfirmed.length} claim(s) that are not confirmed: ${listed}${unconfirmed.length > 3 ? "; …" : ""}. Keep them attributed, or confirm them in Research before approving.`,
    });
  }

  // 4. quotation marks only around saved quotes
  const savedQuotes = input.quotes.map((q) => normalizeForMatch(q.text)).filter(Boolean);
  const unbackedQuotes = extractQuotations(text).filter((quoted) => {
    const n = normalizeForMatch(quoted);
    return n.length > 0 && !savedQuotes.some((saved) => saved.includes(n));
  });
  if (unbackedQuotes.length) {
    const listed = unbackedQuotes
      .slice(0, 3)
      .map((q) => `“${clip(q, 80)}”`)
      .join("; ");
    warnings.push({
      kind: "unbacked_quote",
      message: `${listed} ${unbackedQuotes.length === 1 ? "is" : "are"} quoted but not in the research quotes. Use the exact saved words or paraphrase without quotation marks.`,
    });
  }

  // 5. thin research is said out loud
  if (factsUsed.length === 0) {
    warnings.push({
      kind: "no_facts",
      message:
        input.facts.length === 0
          ? "No research facts were available: the script stays general. Add claims in Research, then regenerate."
          : "The script does not cite any provided fact. Check every statement before approving.",
    });
  }
  for (const item of (input.missing ?? []).map((m) => m.trim()).filter(Boolean).slice(0, 8)) {
    warnings.push({ kind: "missing_info", message: clip(item, 240) });
  }

  return {
    factsUsed,
    quoteIdsUsed,
    warnings: warnings.slice(0, MAX_WARNINGS).map(formatWarning),
    checks: {
      droppedFactIds,
      droppedQuoteIds,
      ungroundedNumbers,
      unconfirmedFactIds: unconfirmed.map((f) => f.id),
      unbackedQuotes,
    },
  };
}

/** words per second of a calm voiceover (150 wpm), for the duration estimate */
export const VOICEOVER_WPS = 2.5;

export function estimateDurationSec(words: number): number | null {
  if (words <= 0) return null;
  return Math.max(5, Math.min(7200, Math.round(words / VOICEOVER_WPS)));
}
