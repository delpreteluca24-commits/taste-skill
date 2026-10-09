import { z } from "zod";

import type { AIRouter } from "@/lib/ai/router";
import type { AIProviderId, AIUsage } from "@/lib/ai/types";
import { cleanText, filterKnownIds, isPhrasedAsQuestion, normaliseForCompare } from "@/lib/factcheck/sanitize";
import {
  buildResearchSuggestMessages,
  MAX_SOURCES_IN_RESEARCH_PROMPT,
  RESEARCH_SUGGEST_SYSTEM,
  researchSuggestOutputSchema,
  type ResearchSuggestInput,
  type ResearchSuggestOutput,
} from "@/prompts/research/suggest";

import { parseDateInput } from "./schema";

/**
 * AI research assist (RESEARCH task) — request + sanitising (pure apart from
 * the router call). NEVER INVENT FACTS:
 * - source ids not in the provided set are dropped
 * - a claim with no valid source is dropped, unless it is phrased as a
 *   question (then it becomes an open question)
 * - timeline events and context notes need a valid source too
 * - nothing that already exists in the workspace is suggested again
 * Statuses are not part of the output at all: callers store claims as
 * 'uncertain' and link their sources as 'mentions'.
 */

export const SUGGESTION_LIMITS = { claims: 8, questions: 8, timeline: 10, context: 5 } as const;

const MAX_CLAIM_CHARS = 1000;
const MAX_QUESTION_CHARS = 500;
const MAX_EVENT_CHARS = 500;
const MAX_NOTE_CHARS = 1500;

export type ExistingResearchText = {
  claims: readonly string[];
  questions: readonly string[];
  timeline: readonly string[];
  context: readonly string[];
};

export type SuggestedClaim = { claim: string; sourceIds: string[]; isCritical: boolean };
export type SuggestedTimelineEvent = { occurredAt: string | null; event: string; sourceIds: string[] };
export type SuggestedContext = { title: string | null; note: string; sourceIds: string[] };

export type DroppedCounts = {
  /** source ids returned by the model that were not provided */
  foreignSourceIds: number;
  /** claims without any valid source (not phrased as a question) */
  unsourcedClaims: number;
  /** unsourced claims kept as open questions */
  claimsAsQuestions: number;
  unsourcedTimeline: number;
  unsourcedContext: number;
  /** dates that were not a real calendar date (event kept, date removed) */
  invalidDates: number;
  /** already in the workspace or repeated in the output */
  duplicates: number;
  /** empty, too long or over the per-list limit */
  discarded: number;
};

export type SanitisedSuggestions = {
  claims: SuggestedClaim[];
  questions: string[];
  timeline: SuggestedTimelineEvent[];
  context: SuggestedContext[];
  dropped: DroppedCounts;
};

export function emptyDropped(): DroppedCounts {
  return {
    foreignSourceIds: 0,
    unsourcedClaims: 0,
    claimsAsQuestions: 0,
    unsourcedTimeline: 0,
    unsourcedContext: 0,
    invalidDates: 0,
    duplicates: 0,
    discarded: 0,
  };
}

/** Dedupe set seeded with what the workspace already holds. */
function seen(existing: readonly string[]) {
  const keys = new Set(existing.map(normaliseForCompare).filter(Boolean));
  return {
    /** true when the text is new (and remembers it) */
    add(text: string) {
      const key = normaliseForCompare(text);
      if (!key || keys.has(key)) return false;
      keys.add(key);
      return true;
    },
  };
}

export function sanitiseResearchSuggestions(
  output: ResearchSuggestOutput,
  allowedSourceIds: Iterable<string>,
  existing: ExistingResearchText,
): SanitisedSuggestions {
  const allowed = new Set(allowedSourceIds);
  const dropped = emptyDropped();
  const known = (ids: readonly string[]) => {
    const r = filterKnownIds(ids, allowed);
    dropped.foreignSourceIds += r.dropped;
    return r.ids;
  };

  const questionKeys = seen(existing.questions);
  const claimKeys = seen(existing.claims);
  const timelineKeys = seen(existing.timeline);
  const contextKeys = seen(existing.context);

  const questions: string[] = [];
  const pushQuestion = (raw: string) => {
    const q = cleanText(raw);
    if (!q || q.length > MAX_QUESTION_CHARS) return void (dropped.discarded += 1);
    if (questions.length >= SUGGESTION_LIMITS.questions) return void (dropped.discarded += 1);
    if (!questionKeys.add(q)) return void (dropped.duplicates += 1);
    questions.push(q);
  };

  const claims: SuggestedClaim[] = [];
  for (const c of output.claims) {
    const text = cleanText(c.claim);
    if (!text || text.length > MAX_CLAIM_CHARS) {
      dropped.discarded += 1;
      continue;
    }
    const ids = known(c.sourceIds);
    if (ids.length === 0) {
      // unverifiable: keep only when it is already a question
      if (isPhrasedAsQuestion(text)) {
        dropped.claimsAsQuestions += 1;
        pushQuestion(text);
      } else {
        dropped.unsourcedClaims += 1;
      }
      continue;
    }
    if (isPhrasedAsQuestion(text)) {
      // a question is not a claim, even with sources
      pushQuestion(text);
      continue;
    }
    if (claims.length >= SUGGESTION_LIMITS.claims) {
      dropped.discarded += 1;
      continue;
    }
    if (!claimKeys.add(text)) {
      dropped.duplicates += 1;
      continue;
    }
    claims.push({ claim: text, sourceIds: ids, isCritical: c.isCritical !== false });
  }

  for (const q of output.questions) pushQuestion(q);

  const timeline: SuggestedTimelineEvent[] = [];
  for (const t of output.timeline) {
    const event = cleanText(t.event);
    if (!event || event.length > MAX_EVENT_CHARS) {
      dropped.discarded += 1;
      continue;
    }
    const ids = known(t.sourceIds);
    if (ids.length === 0) {
      dropped.unsourcedTimeline += 1;
      continue;
    }
    if (timeline.length >= SUGGESTION_LIMITS.timeline) {
      dropped.discarded += 1;
      continue;
    }
    if (!timelineKeys.add(event)) {
      dropped.duplicates += 1;
      continue;
    }
    let occurredAt: string | null = null;
    if (t.date && t.date.trim()) {
      occurredAt = parseDateInput(t.date.trim().slice(0, 10));
      if (!occurredAt) dropped.invalidDates += 1;
    }
    timeline.push({ occurredAt, event, sourceIds: ids });
  }
  timeline.sort((a, b) => (a.occurredAt ?? "9999").localeCompare(b.occurredAt ?? "9999"));

  const context: SuggestedContext[] = [];
  for (const n of output.context) {
    const note = cleanText(n.note);
    if (!note || note.length > MAX_NOTE_CHARS) {
      dropped.discarded += 1;
      continue;
    }
    const ids = known(n.sourceIds);
    if (ids.length === 0) {
      dropped.unsourcedContext += 1;
      continue;
    }
    if (context.length >= SUGGESTION_LIMITS.context) {
      dropped.discarded += 1;
      continue;
    }
    if (!contextKeys.add(note)) {
      dropped.duplicates += 1;
      continue;
    }
    const title = cleanText(n.title).slice(0, 200);
    context.push({ title: title || null, note, sourceIds: ids });
  }

  return { claims, questions, timeline, context, dropped };
}

export type ResearchSuggestResult = {
  suggestions: SanitisedSuggestions;
  /** ids of the sources actually sent to the model */
  providedSourceIds: string[];
  provider: AIProviderId;
  model: string;
  usage: AIUsage;
  costUsd: number | null;
};

/** One RESEARCH call through the router, then the sanitiser above. */
export async function requestResearchSuggestions(
  ai: AIRouter,
  input: ResearchSuggestInput,
  existing: ExistingResearchText,
): Promise<ResearchSuggestResult> {
  const sent = input.sources.slice(0, MAX_SOURCES_IN_RESEARCH_PROMPT);
  const res = await ai.generateObject(
    "research",
    {
      system: RESEARCH_SUGGEST_SYSTEM,
      messages: buildResearchSuggestMessages({ ...input, sources: sent }),
      cacheSystemPrompt: true,
    },
    researchSuggestOutputSchema,
  );
  const providedSourceIds = sent.map((s) => s.id);
  return {
    suggestions: sanitiseResearchSuggestions(res.data, providedSourceIds, existing),
    providedSourceIds,
    provider: res.provider,
    model: res.model,
    usage: res.usage,
    costUsd: res.costUsd,
  };
}

/* ------------------------------------------------------------------------- */
/* job result (read side)                                                    */
/* ------------------------------------------------------------------------- */

const count = z.number().int().min(0).catch(0);
const runSummarySchema = z.object({
  model: z.string().max(120).nullish().catch(null),
  costUsd: z.number().min(0).nullish().catch(null),
  sourcesProvided: count.optional(),
  inserted: z.object({ claims: count, questions: count, timeline: count, context: count }),
  dropped: z
    .object({ foreignSourceIds: count, unsourcedClaims: count, unsourcedTimeline: count, unsourcedContext: count, duplicates: count })
    .partial()
    .catch({}),
  droppedTotal: count.optional(),
});

export type SuggestRunSummary = {
  model: string | null;
  costUsd: number | null;
  sourcesProvided: number;
  inserted: { claims: number; questions: number; timeline: number; context: number };
  /** items removed because they cited sources we did not provide, or none at all */
  droppedUnsourced: number;
  duplicates: number;
};

/** research.suggest job result → what the workspace shows about the last run (null when unreadable). */
export function readSuggestRunSummary(result: unknown): SuggestRunSummary | null {
  const parsed = runSummarySchema.safeParse(result);
  if (!parsed.success) return null;
  const r = parsed.data;
  const d = r.dropped;
  return {
    model: r.model ?? null,
    costUsd: r.costUsd ?? null,
    sourcesProvided: r.sourcesProvided ?? 0,
    inserted: r.inserted,
    droppedUnsourced: (d.unsourcedClaims ?? 0) + (d.unsourcedTimeline ?? 0) + (d.unsourcedContext ?? 0),
    duplicates: d.duplicates ?? 0,
  };
}
