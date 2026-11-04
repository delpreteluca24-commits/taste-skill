import { entityTermsOf, extractEntities, GENERIC_WORDS, keywordsOf, type EntityMention } from "./text";

export { extractEntities, keywordsOf, normalizeText, stem, tokenize, STOPWORDS_EN, STOPWORDS_IT } from "./text";
export type { EntityMention } from "./text";

/**
 * Trend clustering: groups recent sources that cover the SAME story and
 * matches each group to an existing trend. Deterministic (same input → same
 * clusters, whatever the input order) and fully rule-based so every grouping
 * can be explained.
 *
 * A source is profiled by
 *   - keywords: stemmed title words without stopwords/generic sports words
 *   - entity terms: words of capitalized names ("Jannik Sinner" → jannik, sinner),
 *     taken from the title and the first sentence of the summary
 *
 * Two profiles are the SAME STORY when (thresholds in SAME_STORY):
 *   (a) they share ≥ 2 entity terms and keyword Jaccard ≥ 0.10, or
 *   (b) they share ≥ 1 entity term  and keyword Jaccard ≥ 0.25, or
 *   (c) keyword Jaccard ≥ 0.40 (headlines without recognizable names)
 * A shared name alone is never enough: "Sinner wins Shanghai" and "Sinner
 * withdraws from Paris" are two stories about the same player.
 */

export const SAME_STORY = {
  /** rule (a) */
  strongEntityTerms: 2,
  strongKeywordJaccard: 0.1,
  /** rule (b) */
  entityKeywordJaccard: 0.25,
  /** rule (c) */
  keywordOnlyJaccard: 0.4,
} as const;

/** how many keywords / entity terms describe a cluster or a stored trend */
export const PROFILE_SIZE = 12;

export type TextProfile = {
  keywords: string[];
  entityTerms: string[];
  entities: EntityMention[];
};

function firstSentence(text: string | null | undefined): string {
  if (!text) return "";
  const m = /^(.{20,}?[.!?])(\s|$)/s.exec(text.trim());
  return (m ? m[1] : text).slice(0, 300);
}

/**
 * Profile of one source. Keywords come from the title (summaries vary too much
 * between outlets to compare word sets); a source without a title uses its
 * summary's first sentence.
 */
export function profileSource(input: { title: string | null; summary: string | null }): TextProfile {
  const title = input.title?.trim() ?? "";
  const lead = firstSentence(input.summary);
  const keywords = keywordsOf(title || lead);
  const entities = extractEntities([title, lead].filter(Boolean).join(". "));
  return { keywords, entityTerms: entityTermsOf(entities), entities };
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

export type Comparison = {
  keywordJaccard: number;
  sharedEntityTerms: string[];
  /** which SAME_STORY rule matched, null = different stories */
  rule: "a" | "b" | "c" | null;
  /** ranking value among candidates: Jaccard + 0.1 per shared entity term (max 3) */
  score: number;
};

export function compareProfiles(a: Pick<TextProfile, "keywords" | "entityTerms">, b: Pick<TextProfile, "keywords" | "entityTerms">): Comparison {
  const keywordJaccard = jaccard(a.keywords, b.keywords);
  const bTerms = new Set(b.entityTerms);
  const sharedEntityTerms = [...new Set(a.entityTerms)].filter((t) => bTerms.has(t)).sort();
  const se = sharedEntityTerms.length;
  let rule: Comparison["rule"] = null;
  if (se >= SAME_STORY.strongEntityTerms && keywordJaccard >= SAME_STORY.strongKeywordJaccard) rule = "a";
  else if (se >= 1 && keywordJaccard >= SAME_STORY.entityKeywordJaccard) rule = "b";
  else if (keywordJaccard >= SAME_STORY.keywordOnlyJaccard) rule = "c";
  return { keywordJaccard, sharedEntityTerms, rule, score: keywordJaccard + 0.1 * Math.min(se, 3) };
}

export type ClusterDoc = {
  id: string;
  /** epoch ms (published, else retrieved) */
  time: number;
  profile: TextProfile;
};

/**
 * Single-pass, single-link clustering in chronological order (ties by id):
 * each source joins the cluster holding its most similar SAME-STORY source,
 * or opens a new cluster. Sorting first makes the result independent of the
 * input order. O(n²) comparisons — fine for the radar window (≤ 1,000 sources).
 */
export function clusterDocuments(docs: readonly ClusterDoc[]): string[][] {
  const sorted = [...docs].sort((x, y) => x.time - y.time || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const clusters: ClusterDoc[][] = [];
  for (const doc of sorted) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < clusters.length; index++) {
      for (const m of clusters[index]) {
        const c = compareProfiles(doc.profile, m.profile);
        if (c.rule && c.score > bestScore) {
          bestIndex = index;
          bestScore = c.score;
        }
      }
    }
    if (bestIndex >= 0) clusters[bestIndex].push(doc);
    else clusters.push([doc]);
  }
  return clusters.map((members) => members.map((m) => m.id));
}

export type AggregateProfile = {
  /** top keywords by number of sources using them, then alphabetical */
  keywords: string[];
  entityTerms: string[];
  /** top entities (display form) by number of sources mentioning them */
  entities: { key: string; display: string; sources: number }[];
};

function topByCount(lists: readonly (readonly string[])[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const x of new Set(list)) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, k)
    .map(([x]) => x);
}

/** Profile of a group of sources (cluster or trend): the most shared words and names. */
export function aggregateProfiles(profiles: readonly TextProfile[], k = PROFILE_SIZE): AggregateProfile {
  const entityCounts = new Map<string, { key: string; display: string; sources: number }>();
  for (const p of profiles) {
    for (const e of p.entities) {
      const cur = entityCounts.get(e.key);
      if (cur) cur.sources += 1;
      else entityCounts.set(e.key, { key: e.key, display: e.display, sources: 1 });
    }
  }
  const entities = [...entityCounts.values()]
    .sort((a, b) => b.sources - a.sources || b.key.split(" ").length - a.key.split(" ").length || (a.key < b.key ? -1 : 1))
    .slice(0, 6);
  return {
    keywords: topByCount(
      profiles.map((p) => p.keywords),
      k,
    ),
    entityTerms: topByCount(
      profiles.map((p) => p.entityTerms),
      k,
    ),
    entities,
  };
}

export type TrendCandidate = { id: string; keywords: readonly string[]; entityTerms: readonly string[] };
export type TrendMatch = { trendId: string; comparison: Comparison };

/**
 * Match a new cluster to an existing trend by keyword (+ entity) overlap of
 * their aggregate profiles, with the same SAME_STORY rules. Best score wins;
 * ties go to the first candidate (callers pass trends in a stable order).
 */
export function matchTrend(cluster: Pick<AggregateProfile, "keywords" | "entityTerms">, trends: readonly TrendCandidate[]): TrendMatch | null {
  let best: TrendMatch | null = null;
  for (const t of trends) {
    const comparison = compareProfiles(cluster, { keywords: [...t.keywords], entityTerms: [...t.entityTerms] });
    if (comparison.rule && (!best || comparison.score > best.comparison.score)) best = { trendId: t.id, comparison };
  }
  return best;
}

export type EventCandidate = { id: string; title: string; starts_at: string | null; status: string };

/** event title words that never identify a fixture */
const EVENT_GENERIC = new Set(["final", "semifinal", "round", "leg", "grand", "prix", "open", "cup", "match", "day", "week", "stage", "tour", "race", "fixture", "giornata", "turno", "andata", "ritorno", "finale"]);

/** linked events must start within this many hours of the cluster's latest source */
export const EVENT_MATCH_WINDOW_HOURS = 72;

/**
 * Link a trend to an event only when it is OBVIOUS:
 *   - the event starts within ±72h of the cluster's latest source, and
 *   - at least 2 identifying words of the event title (team/athlete names,
 *     not "final"/"round") appear in the cluster's keywords or names, covering
 *     at least half of the event's identifying words, and
 *   - no other event matches equally well (ambiguous → no link).
 */
export function matchEvent(
  cluster: Pick<AggregateProfile, "keywords" | "entityTerms">,
  events: readonly EventCandidate[],
  referenceTime: number,
): { eventId: string; matched: string[] } | null {
  const clusterTerms = new Set([...cluster.keywords, ...cluster.entityTerms, ...cluster.entityTerms.map((t) => keywordsOf(t)[0]).filter(Boolean)]);
  let best: { eventId: string; matched: string[]; ratio: number } | null = null;
  let tie = false;
  for (const e of events) {
    if (e.status === "cancelled" || !e.starts_at) continue;
    const hours = Math.abs(Date.parse(e.starts_at) - referenceTime) / 3_600_000;
    if (!Number.isFinite(hours) || hours > EVENT_MATCH_WINDOW_HOURS) continue;
    const terms = keywordsOf(e.title).filter((t) => !EVENT_GENERIC.has(t) && !GENERIC_WORDS.has(t) && !/^\d+$/.test(t));
    if (terms.length === 0) continue;
    const matched = terms.filter((t) => clusterTerms.has(t));
    const ratio = matched.length / terms.length;
    if (matched.length < 2 || ratio < 0.5) continue;
    if (!best || matched.length > best.matched.length || (matched.length === best.matched.length && ratio > best.ratio)) {
      best = { eventId: e.id, matched, ratio };
      tie = false;
    } else if (matched.length === best.matched.length && ratio === best.ratio) {
      tie = true;
    }
  }
  return best && !tie ? { eventId: best.eventId, matched: best.matched } : null;
}

/**
 * The id most of a group agrees on, when obvious: the most common non-null id
 * if it covers at least 2/3 of the members that have one. Otherwise null.
 */
export function majorityId(ids: readonly (string | null)[]): string | null {
  const known = ids.filter((s): s is string => Boolean(s));
  if (known.length === 0) return null;
  const counts = new Map<string, number>();
  for (const s of known) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return top[1] / known.length >= 2 / 3 ? top[0] : null;
}

/** Sport of a group when obvious (see majorityId). */
export function majoritySport(sportIds: readonly (string | null)[]): string | null {
  return majorityId(sportIds);
}
