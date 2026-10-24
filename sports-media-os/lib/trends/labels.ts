import type { AIRouter } from "@/lib/ai/router";
import { AIError } from "@/lib/ai/types";
import {
  buildTrendLabelMessages,
  MAX_CLUSTERS_PER_CALL,
  MAX_HEADLINES_PER_CLUSTER,
  TREND_LABEL_PROMPT_VERSION,
  TREND_LABEL_SYSTEM,
  trendLabelOutputSchema,
  type TrendLabelOutput,
} from "@/prompts/discovery/trend-label";

import type { AggregateProfile } from "./cluster";
import { GENERIC_WORDS, isStopword, normalizeText } from "./text";

/**
 * Trend titles. The heuristic title (top names of the cluster) always exists;
 * an AI label replaces it only when it passes validation:
 *   - the cluster key and every source id are ones we sent for THAT cluster
 *   - grounding: every capitalized word and every number in the label appears
 *     in the cluster's headlines (catches invented names, teams and scores;
 *     a paraphrase in lowercase words cannot be checked this way)
 */

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 300;

/** ordinary label words that may be capitalized without appearing in headlines */
// prettier-ignore
const LABEL_WORDS = new Set([
  "debate", "questions", "reaction", "reactions", "doubts", "concerns", "rumours", "rumors", "speculation", "talks",
  "deal", "row", "controversy", "injury", "transfer", "record", "upset", "victory", "defeat", "draw", "clash",
  "fallout", "criticism", "praise", "comeback", "title", "final", "statement", "coverage", "reports", "outlets",
  "several", "multiple", "headlines", "sources", "news", "update", "updates", "build", "buildup", "aftermath",
  "ahead", "following", "after", "before", "during", "derby", "rivalry", "stats", "statistics", "streak",
  "one", "two", "three", "four", "five", "both", "many", "report", "says", "say",
]);

export type HeadlineRef = { id: string; title: string; publisher: string | null };
export type LabelCluster = { key: string; headlines: HeadlineRef[] };
export type AcceptedLabel = { title: string; description: string | null; sourceIds: string[] };
export type LabelRejection = { key: string; reason: string };

export type LabelOutcome = {
  status: "labelled" | "not_configured" | "failed" | "skipped";
  accepted: Map<string, AcceptedLabel>;
  rejected: LabelRejection[];
  model: string | null;
  costUsd: number | null;
  promptVersion: string;
  error?: string;
};

function wordsOf(text: string): string[] {
  return text.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/i, ""));
}

/**
 * Names and numbers in `text` that do not appear in `headlines`.
 * Checked: words containing a digit (must appear verbatim, e.g. "3-0") and
 * capitalized words — also at the start of a sentence, where only stopwords,
 * generic sports words and ordinary label words ("Reports", "Two") are exempt.
 */
export function findUngroundedTerms(text: string, headlines: readonly string[]): string[] {
  const haystack = normalizeText(headlines.join(" \n "));
  const tokens = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
  const out = new Set<string>();
  for (const word of wordsOf(text)) {
    if (!word) continue;
    const norm = normalizeText(word);
    if (/\d/.test(word)) {
      if (!haystack.includes(norm)) out.add(word);
      continue;
    }
    if (!/^\p{Lu}/u.test(word)) continue;
    const parts = norm.split(/[^a-z0-9]+/).filter(Boolean);
    const grounded = parts.every((p) => tokens.has(p) || isStopword(p) || GENERIC_WORDS.has(p) || LABEL_WORDS.has(p));
    if (!grounded) out.add(word);
  }
  return [...out];
}

/** Validate model output against the clusters we sent. Pure. */
export function validateLabels(output: TrendLabelOutput, clusters: readonly LabelCluster[]): { accepted: Map<string, AcceptedLabel>; rejected: LabelRejection[] } {
  const byKey = new Map(clusters.map((c) => [c.key, c]));
  const accepted = new Map<string, AcceptedLabel>();
  const rejected: LabelRejection[] = [];

  for (const label of output.labels) {
    const cluster = byKey.get(label.cluster);
    if (!cluster) {
      rejected.push({ key: label.cluster.slice(0, 64), reason: "unknown cluster key" });
      continue;
    }
    if (accepted.has(label.cluster)) {
      rejected.push({ key: label.cluster, reason: "duplicate label for the same cluster" });
      continue;
    }
    const allowed = new Set(cluster.headlines.map((h) => h.id));
    const foreign = label.source_ids.filter((id) => !allowed.has(id));
    if (foreign.length) {
      rejected.push({ key: label.cluster, reason: `cites ${foreign.length} source id(s) not in this cluster` });
      continue;
    }
    const title = label.title.replace(/\s+/g, " ").trim();
    const description = label.description?.replace(/\s+/g, " ").trim() || null;
    if (title.length > TITLE_MAX || (description?.length ?? 0) > DESCRIPTION_MAX) {
      rejected.push({ key: label.cluster, reason: "label too long" });
      continue;
    }
    const titles = cluster.headlines.map((h) => h.title);
    const ungrounded = [...findUngroundedTerms(title, titles), ...(description ? findUngroundedTerms(description, titles) : [])];
    if (ungrounded.length) {
      rejected.push({ key: label.cluster, reason: `not in the headlines: ${[...new Set(ungrounded)].slice(0, 5).join(", ")}` });
      continue;
    }
    accepted.set(label.cluster, { title, description, sourceIds: [...new Set(label.source_ids)] });
  }
  return { accepted, rejected };
}

/**
 * One DISCOVERY call for up to MAX_CLUSTERS_PER_CALL clusters. Never throws:
 * when AI is not configured or fails, the outcome says so and callers keep
 * the heuristic titles (AI never blocks detection).
 */
export async function labelClusters(ai: AIRouter, clusters: readonly LabelCluster[]): Promise<LabelOutcome> {
  const base = { accepted: new Map<string, AcceptedLabel>(), rejected: [] as LabelRejection[], promptVersion: TREND_LABEL_PROMPT_VERSION };
  const batch = clusters
    .filter((c) => c.headlines.length > 0)
    .slice(0, MAX_CLUSTERS_PER_CALL)
    .map((c) => ({ key: c.key, headlines: c.headlines.slice(0, MAX_HEADLINES_PER_CLUSTER) }));
  if (batch.length === 0) return { ...base, status: "skipped", model: null, costUsd: null };

  try {
    const res = await ai.generateObject(
      "discovery",
      { system: TREND_LABEL_SYSTEM, messages: buildTrendLabelMessages({ clusters: batch }), cacheSystemPrompt: true },
      trendLabelOutputSchema,
    );
    const { accepted, rejected } = validateLabels(res.data, batch);
    return { ...base, status: "labelled", accepted, rejected, model: res.model, costUsd: res.costUsd };
  } catch (e) {
    const notConfigured = e instanceof AIError && e.kind === "not_configured";
    return {
      ...base,
      status: notConfigured ? "not_configured" : "failed",
      model: null,
      costUsd: null,
      error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    };
  }
}

/**
 * Heuristic title from the cluster's most shared names ("Sinner · Alcaraz ·
 * Shanghai"); without names, its top keywords; without either, the newest
 * headline. Deterministic and made only of words from the sources.
 */
export function heuristicTitle(profile: Pick<AggregateProfile, "entities" | "keywords">, fallbackHeadline: string | null): string {
  const names: string[] = [];
  for (const e of profile.entities) {
    // skip a name already contained in a longer one ("Sinner" inside "Jannik Sinner")
    if (names.some((n) => normalizeText(n).split(" ").includes(e.key) || e.key.split(" ").includes(normalizeText(n)))) continue;
    names.push(e.display);
    if (names.length === 3) break;
  }
  if (names.length >= 2 || (names.length === 1 && !fallbackHeadline)) return names.join(" · ").slice(0, TITLE_MAX);
  if (fallbackHeadline?.trim()) return fallbackHeadline.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
  if (names.length) return names.join(" · ");
  const words = profile.keywords.slice(0, 4);
  return words.length ? words.join(" · ") : "Untitled story";
}
