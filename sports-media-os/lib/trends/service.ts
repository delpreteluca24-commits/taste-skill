import { randomUUID } from "node:crypto";

import type { AIRouter } from "@/lib/ai/router";
import type { Db, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { detectEventSignals, detectTextSignals, type RadarSignal, type SignalDetection, type SignalMatch } from "@/lib/radar/signals";
import type { Database, Json } from "@/types/database";

import {
  aggregateProfiles,
  clusterDocuments,
  majorityId,
  majoritySport,
  matchEvent,
  matchTrend,
  profileSource,
  type Comparison,
  type TextProfile,
  type TrendCandidate,
} from "./cluster";
import { DESCRIPTION_MAX, heuristicTitle, labelClusters, type LabelOutcome } from "./labels";
import { computeTrendMetrics, METRICS_VERSION, STATUS_RULES, type TrendMetrics } from "./metrics";
import { escapeLike, type TrendFilters } from "./schema";

/**
 * Trend Engine service (Trend Hunter). Every function takes the database
 * client first: the worker runs detectTrends with the SERVICE ROLE (RLS
 * bypassed), so EVERY query here is filtered by project_id; pages call the
 * read functions with the signed-in user's client (RLS + project filter).
 *
 * detectTrends(db, projectId, { sinceHours, ai }):
 *   1. load the project's sources published (else retrieved) in the window,
 *      the active trends and their linked sources
 *   2. detect text signals per source → sources.signals (only when changed)
 *   3. cluster sources not linked to any trend yet (lib/trends/cluster.ts)
 *   4. each cluster joins the best-matching active trend, or opens a new one
 *      when it has ≥ 2 sources or 1 source with a strong signal (a cluster
 *      whose newest source is already older than the 72h expiry opens nothing)
 *   5. recompute metrics for every active trend with sources (lib/trends/metrics.ts),
 *      link the event when obvious (most of its sources carry that event_id,
 *      or the fixture's team/athlete names appear in its headlines)
 *   6. optional AI labels (DISCOVERY task) for heuristic titles — never blocking;
 *      a trend is sent again only when its source count changed since the
 *      last attempt (cost control)
 *   7. upsert trends + trend_sources (idempotent), expire trends without a new
 *      source for 72h
 *
 * Idempotent: a source linked to a trend stays linked (re-runs never move or
 * duplicate links), and re-running on the same data creates nothing new.
 */

export const DETECTOR_VERSION = "trend-detector-v1";
export const DEFAULT_SINCE_HOURS = 48;
/** cost/size guards for one run */
export const MAX_WINDOW_SOURCES = 1000;
export const MAX_ACTIVE_TRENDS = 500;
export const MAX_AI_LABELS_PER_RUN = 20;
/** a new trend needs this many sources … */
export const MIN_CLUSTER_SOURCES = 2;
/** … or ONE source carrying one of these high-curiosity signals */
export const STANDALONE_SIGNALS: readonly RadarSignal[] = ["breaking", "upset", "record", "unusual_stat", "controversy"];

const HOUR = 3_600_000;
/** ids per `in (…)` filter: keeps PostgREST URLs well under proxy limits (100 uuids ≈ 3.7 KB) */
const CHUNK = 100;

type SourceRow = Pick<
  Tables<"sources">,
  "id" | "name" | "title" | "summary" | "url" | "published_at" | "retrieved_at" | "credibility" | "signals" | "sport_id" | "event_id"
>;
const SOURCE_COLUMNS = "id, name, title, summary, url, published_at, retrieved_at, credibility, signals, sport_id, event_id";

type TrendRow = Pick<
  Tables<"trends">,
  "id" | "title" | "description" | "keywords" | "metadata" | "status" | "sport_id" | "event_id" | "first_seen_at" | "last_seen_at" | "is_sweet_spot"
>;
const TREND_COLUMNS = "id, title, description, keywords, metadata, status, sport_id, event_id, first_seen_at, last_seen_at, is_sweet_spot";

type EventRow = Pick<Tables<"events">, "id" | "title" | "starts_at" | "ends_at" | "status" | "sport_id">;
const EVENT_COLUMNS = "id, title, starts_at, ends_at, status, sport_id";

type TrendUpsert = Database["public"]["Tables"]["trends"]["Insert"] & { id: string };
type TitleOrigin = "heuristic" | "ai" | "manual";

type Analyzed = {
  row: SourceRow;
  time: number;
  publisher: string;
  profile: TextProfile;
  detection: SignalDetection;
};

export type DetectOptions = {
  sinceHours?: number;
  /** DISCOVERY-task router for titles; omitted/null → heuristic titles only */
  ai?: AIRouter | null;
  now?: Date;
  maxAILabels?: number;
};

export type DetectResult = {
  sinceHours: number;
  sourcesScanned: number;
  signalsUpdated: number;
  clusters: number;
  trendsCreated: number;
  trendsUpdated: number;
  sourcesLinked: number;
  /** window sources not (yet) part of any trend: singletons without a strong signal */
  unclustered: number;
  trendsExpired: number;
  sweetSpots: number;
  newSweetSpots: { id: string; title: string }[];
  ai: {
    status: LabelOutcome["status"];
    labelled: number;
    rejected: number;
    model: string | null;
    costUsd: number | null;
    error?: string;
  };
};

class StepError extends Error {}

function must<T>(res: { data: T | null; error: { code?: string; message: string } | null }, step: string): T {
  if (res.error) {
    logger.error("trends.query_failed", { step, code: res.error.code, message: res.error.message });
    throw new StepError(`trends: ${step} failed (${res.error.code ?? "error"})`);
  }
  return res.data as T;
}

async function inChunks<T>(ids: readonly string[], step: string, query: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(must(await query(ids.slice(i, i + CHUNK)), step) ?? []));
  return out;
}

/** Publisher identity: host without "www." (two feeds of one outlet = one publisher). */
export function publisherOf(url: string, name: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return name.trim().toLowerCase();
  }
}

function sourceTime(row: Pick<SourceRow, "published_at" | "retrieved_at">, now: number): number {
  const t = Date.parse(row.published_at ?? row.retrieved_at);
  return Number.isFinite(t) ? Math.min(t, now) : now;
}

function analyze(row: SourceRow, now: number): Analyzed {
  return {
    row,
    time: sourceTime(row, now),
    publisher: publisherOf(row.url, row.name),
    profile: profileSource({ title: row.title, summary: row.summary }),
    detection: detectTextSignals(row.title, row.summary),
  };
}

const asObject = (v: Json | null | undefined): Record<string, Json | undefined> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : {};
const stringArray = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const iso = (ms: number) => new Date(ms).toISOString();

function titleOrigin(trend: TrendRow | undefined): TitleOrigin {
  if (!trend) return "heuristic";
  const origin = asObject(trend.metadata).title_origin;
  // a trend without a recorded origin was named by someone else: never overwrite it
  return origin === "heuristic" || origin === "ai" ? origin : "manual";
}

function headlineOf(row: SourceRow): string {
  return (row.title ?? row.summary ?? row.url).replace(/\s+/g, " ").trim().slice(0, 300);
}

function heuristicDescription(newest: Analyzed): string {
  return `Latest headline: “${headlineOf(newest.row)}” (${newest.row.name}).`.slice(0, DESCRIPTION_MAX);
}

/** Update sources.signals only where the detected text signals changed (grouped writes). */
async function persistSignals(db: Db, projectId: string, analyzed: readonly Analyzed[]): Promise<number> {
  const groups = new Map<string, { signals: RadarSignal[]; ids: string[] }>();
  for (const a of analyzed) {
    if (sameSet(a.row.signals ?? [], a.detection.signals)) continue;
    const key = a.detection.signals.join(",");
    const g = groups.get(key) ?? { signals: a.detection.signals, ids: [] };
    g.ids.push(a.row.id);
    groups.set(key, g);
  }
  let updated = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += CHUNK) {
      const chunk = g.ids.slice(i, i + CHUNK);
      must(await db.from("sources").update({ signals: g.signals }).eq("project_id", projectId).in("id", chunk), "update source signals");
      updated += chunk.length;
    }
  }
  return updated;
}

export async function detectTrends(db: Db, projectId: string, opts: DetectOptions = {}): Promise<DetectResult> {
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const sinceHours = opts.sinceHours ?? DEFAULT_SINCE_HOURS;
  const since = iso(now - sinceHours * HOUR);

  // 1. sources in the window, active trends, links, out-of-window members --------
  const windowRows = must(
    await db
      .from("sources")
      .select(SOURCE_COLUMNS)
      .eq("project_id", projectId)
      .or(`published_at.gte.${since},and(published_at.is.null,retrieved_at.gte.${since})`)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(MAX_WINDOW_SOURCES),
    "load window sources",
  );
  const trends = must(
    await db
      .from("trends")
      .select(TREND_COLUMNS)
      .eq("project_id", projectId)
      .neq("status", "expired")
      .order("last_seen_at", { ascending: false })
      .order("id")
      .limit(MAX_ACTIVE_TRENDS),
    "load active trends",
  );
  const trendById = new Map(trends.map((t) => [t.id, t]));

  const windowIds = windowRows.map((r) => r.id);
  const linksOfWindow = await inChunks(windowIds, "load source links", (chunk) =>
    db.from("trend_sources").select("trend_id, source_id").eq("project_id", projectId).in("source_id", chunk),
  );
  const linksOfTrends = await inChunks([...trendById.keys()], "load trend links", (chunk) =>
    db.from("trend_sources").select("trend_id, source_id").eq("project_id", projectId).in("trend_id", chunk),
  );

  const rowsById = new Map(windowRows.map((r) => [r.id, r]));
  const missing = [...new Set(linksOfTrends.map((l) => l.source_id))].filter((id) => !rowsById.has(id));
  const memberRows = await inChunks(missing, "load trend sources", (chunk) =>
    db.from("sources").select(SOURCE_COLUMNS).eq("project_id", projectId).in("id", chunk),
  );
  for (const r of memberRows) rowsById.set(r.id, r);

  // 2. signals -------------------------------------------------------------------
  const analyzed = new Map<string, Analyzed>();
  for (const row of rowsById.values()) analyzed.set(row.id, analyze(row, now));
  const signalsUpdated = await persistSignals(db, projectId, [...analyzed.values()]);

  // 3. cluster unlinked window sources --------------------------------------------
  const linked = new Set([...linksOfWindow, ...linksOfTrends].map((l) => l.source_id));
  const members = new Map<string, Set<string>>(trends.map((t) => [t.id, new Set<string>()]));
  for (const l of linksOfTrends) if (analyzed.has(l.source_id)) members.get(l.trend_id)?.add(l.source_id);

  const unlinked = windowRows.filter((r) => !linked.has(r.id)).map((r) => analyzed.get(r.id)!);
  const clusters = clusterDocuments(unlinked.map((a) => ({ id: a.row.id, time: a.time, profile: a.profile })));

  // 4. match clusters to trends / open new trends ----------------------------------
  const candidates: TrendCandidate[] = trends.map((t) => {
    const profiles = [...(members.get(t.id) ?? [])].map((id) => analyzed.get(id)!.profile);
    if (profiles.length) {
      const agg = aggregateProfiles(profiles);
      return { id: t.id, keywords: agg.keywords, entityTerms: agg.entityTerms };
    }
    return { id: t.id, keywords: t.keywords ?? [], entityTerms: stringArray(asObject(t.metadata).entity_terms) };
  });

  const newLinks: { trend_id: string; source_id: string }[] = [];
  const matches = new Map<string, Comparison>();
  const created = new Set<string>();
  let unclustered = 0;
  for (const cluster of clusters) {
    const agg = aggregateProfiles(cluster.map((id) => analyzed.get(id)!.profile));
    const match = matchTrend(agg, candidates);
    let trendId: string;
    if (match) {
      trendId = match.trendId;
      matches.set(trendId, match.comparison);
    } else {
      const strong = cluster.some((id) => analyzed.get(id)!.detection.signals.some((s) => STANDALONE_SIGNALS.includes(s)));
      const newest = Math.max(...cluster.map((id) => analyzed.get(id)!.time));
      const stale = now - newest >= STATUS_RULES.expiredHours * HOUR;
      if ((cluster.length < MIN_CLUSTER_SOURCES && !strong) || stale) {
        unclustered += cluster.length;
        continue;
      }
      trendId = randomUUID();
      created.add(trendId);
      members.set(trendId, new Set());
    }
    for (const id of cluster) {
      members.get(trendId)!.add(id);
      newLinks.push({ trend_id: trendId, source_id: id });
    }
  }

  // 5. metrics + rows -------------------------------------------------------------
  const activePublishers = new Set(windowRows.map((r) => analyzed.get(r.id)!.publisher)).size;
  const sourceEventIds = [...analyzed.values()].map((a) => a.row.event_id).filter((id): id is string => Boolean(id));
  const events = await loadEvents(db, projectId, now, sinceHours, [...trends.map((t) => t.event_id), ...sourceEventIds]);
  const eventById = new Map(events.map((e) => [e.id, e]));

  const rows: TrendUpsert[] = [];
  const computed = new Map<string, { metrics: TrendMetrics; members: Analyzed[] }>();
  for (const [trendId, ids] of members) {
    if (ids.size === 0) continue; // no loaded source: the stale-trend expiry below handles it
    const existing = trendById.get(trendId);
    const list = [...ids].map((id) => analyzed.get(id)!).sort((a, b) => b.time - a.time || (a.row.id < b.row.id ? -1 : 1));
    const agg = aggregateProfiles(list.map((a) => a.profile));
    const lastSeen = list[0].time;

    let eventId = existing?.event_id ?? null;
    let eventMatch: Json | null = null;
    if (!eventId) {
      const fromSources = majorityId(list.map((a) => a.row.event_id));
      const byTitle = fromSources && eventById.has(fromSources) ? null : matchEvent(agg, events, lastSeen);
      if (fromSources && eventById.has(fromSources)) {
        eventId = fromSources;
        eventMatch = { via: "sources" };
      } else if (byTitle) {
        eventId = byTitle.eventId;
        eventMatch = { via: "title", matched_terms: byTitle.matched };
      }
    }
    const event = eventId ? eventById.get(eventId) : undefined;
    const eventSignals: SignalMatch[] = detectEventSignals(event, nowDate);

    const metrics = computeTrendMetrics({
      sources: list.map((a) => ({ id: a.row.id, time: a.time, publisher: a.publisher, credibility: a.row.credibility, signals: a.detection.matches })),
      now: nowDate,
      activePublishers,
      eventSignals,
    });
    computed.set(trendId, { metrics, members: list });

    const origin = titleOrigin(existing);
    const meta = asObject(existing?.metadata);
    const match = matches.get(trendId);
    const metadata: Record<string, Json> = {
      ...(meta as Record<string, Json>),
      detector: DETECTOR_VERSION,
      metrics_version: METRICS_VERSION,
      title_origin: origin,
      entity_terms: agg.entityTerms,
      entities: agg.entities.map((e) => e.display),
      publishers: [...new Set(list.map((a) => a.publisher))].slice(0, 20),
      window_hours: sinceHours,
    };
    if (match) {
      metadata.last_match = { rule: match.rule, keyword_jaccard: Math.round(match.keywordJaccard * 100) / 100, shared_entity_terms: match.sharedEntityTerms };
    }
    if (eventMatch) metadata.event_match = eventMatch;

    const firstSeen = Math.min(list[list.length - 1].time, existing ? Date.parse(existing.first_seen_at) : Infinity);
    rows.push({
      id: trendId,
      project_id: projectId,
      title: origin === "heuristic" ? heuristicTitle(agg, headlineOf(list[0].row)) : existing!.title,
      description: origin === "heuristic" ? heuristicDescription(list[0]) : (existing?.description ?? null),
      keywords: agg.keywords,
      sport_id: existing?.sport_id ?? majoritySport(list.map((a) => a.row.sport_id)) ?? event?.sport_id ?? null,
      event_id: eventId,
      trend_score: metrics.interest,
      velocity: metrics.velocity,
      volume: metrics.volume,
      status: metrics.status,
      first_seen_at: iso(Number.isFinite(firstSeen) ? firstSeen : lastSeen),
      last_seen_at: iso(lastSeen),
      metadata,
      curiosity_score: metrics.curiosity,
      competition_level: metrics.competition,
      publisher_count: metrics.publisherCount,
      source_count: metrics.volume,
      signals: metrics.signals,
      radar_score: metrics.radarScore,
      is_sweet_spot: metrics.isSweetSpot,
      radar_explanation: metrics.explanation as unknown as Json,
    });
  }

  // 6. AI labels for heuristic titles, merged into the rows before the write ------
  const ai = await applyAILabels(projectId, opts, rows, computed, nowDate);

  // 7. writes: trends first (links reference them), then links, then expiry ---------
  for (let i = 0; i < rows.length; i += 100) {
    must(await db.from("trends").upsert(rows.slice(i, i + 100), { onConflict: "id" }), "upsert trends");
  }
  for (let i = 0; i < newLinks.length; i += CHUNK) {
    const chunk = newLinks.slice(i, i + CHUNK).map((l) => ({ ...l, project_id: projectId }));
    must(await db.from("trend_sources").upsert(chunk, { onConflict: "trend_id,source_id", ignoreDuplicates: true }), "link sources");
  }
  const staleBefore = iso(now - STATUS_RULES.expiredHours * HOUR);
  const expiredNow = must(
    await db
      .from("trends")
      .update({ status: "expired", is_sweet_spot: false })
      .eq("project_id", projectId)
      .neq("status", "expired")
      .lt("last_seen_at", staleBefore)
      .select("id"),
    "expire stale trends",
  );
  const expiredByMetrics = rows.filter((r) => r.status === "expired" && !created.has(r.id)).length;

  const newSweetSpots = rows.filter((r) => r.is_sweet_spot && !trendById.get(r.id)?.is_sweet_spot).map((r) => ({ id: r.id, title: r.title }));

  return {
    sinceHours,
    sourcesScanned: windowRows.length,
    signalsUpdated,
    clusters: clusters.length,
    trendsCreated: created.size,
    trendsUpdated: rows.length - created.size,
    sourcesLinked: newLinks.length,
    unclustered,
    trendsExpired: expiredByMetrics + (expiredNow?.length ?? 0),
    sweetSpots: rows.filter((r) => r.is_sweet_spot).length,
    newSweetSpots,
    ai,
  };
}

/** Events that can be linked (±72h around the window) plus those already referenced by trends or sources. */
async function loadEvents(db: Db, projectId: string, now: number, sinceHours: number, referenced: readonly (string | null)[]): Promise<EventRow[]> {
  const events = must(
    await db
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("project_id", projectId)
      .gte("starts_at", iso(now - (sinceHours + 72) * HOUR))
      .lte("starts_at", iso(now + 72 * HOUR))
      .order("starts_at")
      .order("id")
      .limit(500),
    "load events",
  );
  const have = new Set(events.map((e) => e.id));
  const linked = [...new Set(referenced.filter((id): id is string => Boolean(id) && !have.has(id!)))];
  const extra = await inChunks(linked, "load linked events", (chunk) => db.from("events").select(EVENT_COLUMNS).eq("project_id", projectId).in("id", chunk));
  return [...events, ...extra];
}

/** a previous AI attempt saw the same number of sources: sending it again would cost the same for the same answer */
function alreadyAttempted(row: TrendUpsert): boolean {
  const attempt = asObject(asObject(row.metadata).ai_label_attempt);
  return typeof attempt.source_count === "number" && attempt.source_count === row.source_count;
}

/**
 * One DISCOVERY call names up to `maxAILabels` heuristic-titled trends (best
 * radar score first) from their headlines. Accepted labels replace title and
 * description IN `rows` (written by the single upsert); every real attempt is
 * recorded in metadata.ai_label_attempt so the same trend is not re-sent until
 * new sources join it. Not configured / failure → heuristic titles stay.
 */
async function applyAILabels(
  projectId: string,
  opts: DetectOptions,
  rows: TrendUpsert[],
  computed: Map<string, { metrics: TrendMetrics; members: Analyzed[] }>,
  now: Date,
): Promise<DetectResult["ai"]> {
  const skipped: DetectResult["ai"] = { status: "skipped", labelled: 0, rejected: 0, model: null, costUsd: null };
  if (!opts.ai) return skipped;

  const candidates = rows
    .filter((r) => asObject(r.metadata).title_origin === "heuristic" && r.status !== "expired" && !alreadyAttempted(r))
    .sort((a, b) => (b.radar_score ?? 0) - (a.radar_score ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, opts.maxAILabels ?? MAX_AI_LABELS_PER_RUN);
  if (candidates.length === 0) return skipped;

  const outcome = await labelClusters(
    opts.ai,
    candidates.map((r) => ({
      key: r.id,
      headlines: (computed.get(r.id)?.members ?? []).map((a) => ({ id: a.row.id, title: headlineOf(a.row), publisher: a.row.name })),
    })),
  );
  if (outcome.status === "not_configured" || outcome.status === "skipped") {
    logger.info("trends.ai_labels_unavailable", { projectId, status: outcome.status });
    return { ...skipped, status: outcome.status };
  }

  const rejectedBy = new Map(outcome.rejected.map((r) => [r.key, r.reason]));
  let labelled = 0;
  for (const row of candidates) {
    const meta = asObject(row.metadata) as Record<string, Json>;
    const label = outcome.accepted.get(row.id);
    const attempt: Json = {
      at: now.toISOString(),
      source_count: row.source_count ?? null,
      prompt_version: outcome.promptVersion,
      model: outcome.model,
      result: label ? "accepted" : outcome.status === "failed" ? "model_failed" : (rejectedBy.get(row.id) ?? "not labelled by the model"),
    };
    if (!label) {
      row.metadata = { ...meta, ai_label_attempt: attempt };
      continue;
    }
    row.metadata = {
      ...meta,
      title_origin: "ai",
      heuristic_title: row.title,
      ai_label_attempt: attempt,
      ai_label: { model: outcome.model, prompt_version: outcome.promptVersion, source_ids: label.sourceIds, labelled_at: now.toISOString() },
    };
    row.title = label.title;
    row.description = label.description ?? row.description ?? null;
    labelled += 1;
  }

  if (outcome.status === "failed") {
    logger.warn("trends.ai_labels_failed", { projectId, error: outcome.error });
    return { status: "failed", labelled: 0, rejected: 0, model: null, costUsd: null, error: outcome.error };
  }
  if (outcome.rejected.length) logger.info("trends.ai_labels_rejected", { projectId, rejected: outcome.rejected.slice(0, 10) });
  return { status: "labelled", labelled, rejected: outcome.rejected.length, model: outcome.model, costUsd: outcome.costUsd };
}

/**
 * Concurrency guard for the worker: another trends.detect of the same project
 * that was claimed BEFORE this job (lease younger than 30 min, ties by id) and
 * is still running. Two detections at once could open duplicate trends for the
 * same new sources, so the later one waits.
 */
export async function detectionRunningAhead(db: Db, projectId: string, job: { id: string; locked_at: string | null }, now = new Date()): Promise<string | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id, locked_at")
    .eq("project_id", projectId)
    .eq("type", "trends.detect")
    .eq("status", "running")
    .neq("id", job.id)
    .gte("locked_at", iso(now.getTime() - 30 * 60_000))
    .limit(20);
  if (error) {
    logger.warn("trends.concurrency_check_failed", { projectId, code: error.code });
    return null;
  }
  const mine = job.locked_at ? Date.parse(job.locked_at) : now.getTime();
  const ahead = (data ?? []).find((j) => {
    const theirs = j.locked_at ? Date.parse(j.locked_at) : Infinity;
    return theirs < mine || (theirs === mine && j.id < job.id);
  });
  return ahead?.id ?? null;
}

/* ------------------------------------------------------------------------- */
/* Reads for /trends (user client: RLS + project filter)                      */
/* ------------------------------------------------------------------------- */

const LIST_COLUMNS =
  "id, title, description, status, trend_score, curiosity_score, competition_level, radar_score, is_sweet_spot, signals, source_count, publisher_count, velocity, first_seen_at, last_seen_at, sport_id, event_id, metadata, sport:sports(name)";

export type TrendListRow = Pick<
  Tables<"trends">,
  | "id"
  | "title"
  | "description"
  | "status"
  | "trend_score"
  | "curiosity_score"
  | "competition_level"
  | "radar_score"
  | "is_sweet_spot"
  | "signals"
  | "source_count"
  | "publisher_count"
  | "velocity"
  | "first_seen_at"
  | "last_seen_at"
  | "sport_id"
  | "event_id"
  | "metadata"
> & { sport: { name: string } | null };

export async function listTrends(db: Db, projectId: string, filters: TrendFilters = {}, limit = 100): Promise<TrendListRow[]> {
  let q = db.from("trends").select(LIST_COLUMNS).eq("project_id", projectId);
  if (filters.status) q = q.eq("status", filters.status);
  else if (!filters.includeExpired) q = q.neq("status", "expired");
  if (filters.competition) q = q.eq("competition_level", filters.competition);
  if (filters.sportId) q = q.eq("sport_id", filters.sportId);
  if (filters.minScore !== undefined) q = q.gte("radar_score", filters.minScore);
  if (filters.sweetSpot) q = q.eq("is_sweet_spot", true);
  if (filters.signal) q = q.contains("signals", [filters.signal]);
  if (filters.search) q = q.ilike("title", `%${escapeLike(filters.search)}%`);
  const { data, error } = await q
    .order("radar_score", { ascending: false, nullsFirst: false })
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("trends.list_failed", { projectId, code: error.code, message: error.message });
    throw new Error("Could not load trends");
  }
  return (data ?? []) as unknown as TrendListRow[];
}

export type TrendSourceView = Pick<
  Tables<"sources">,
  "id" | "name" | "title" | "url" | "summary" | "published_at" | "retrieved_at" | "credibility" | "rights_status" | "signals"
> & {
  publisher: string;
  /** signals re-detected from the stored text, with the words that triggered them */
  matches: SignalMatch[];
};

export type TrendDetail = {
  trend: Tables<"trends"> & { sport: { name: string } | null };
  event: Pick<Tables<"events">, "id" | "title" | "starts_at" | "ends_at" | "status" | "competition"> | null;
  sources: TrendSourceView[];
  opportunities: Pick<Tables<"opportunities">, "id" | "title" | "status" | "opportunity_score" | "created_at">[];
};

export async function getTrendDetail(db: Db, projectId: string, trendId: string): Promise<TrendDetail | null> {
  const { data: trend, error } = await db
    .from("trends")
    .select("*, sport:sports(name)")
    .eq("id", trendId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    logger.error("trends.detail_failed", { projectId, trendId, code: error.code, message: error.message });
    throw new Error("Could not load the trend");
  }
  if (!trend) return null;

  const [links, opportunities, event] = await Promise.all([
    db.from("trend_sources").select("source_id").eq("trend_id", trendId).eq("project_id", projectId).limit(500),
    db
      .from("opportunities")
      .select("id, title, status, opportunity_score, created_at")
      .eq("trend_id", trendId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    trend.event_id
      ? db.from("events").select("id, title, starts_at, ends_at, status, competition").eq("id", trend.event_id).eq("project_id", projectId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const ids = (links.data ?? []).map((l) => l.source_id);
  const sources: TrendSourceView[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db
      .from("sources")
      .select("id, name, title, url, summary, published_at, retrieved_at, credibility, rights_status, signals")
      .eq("project_id", projectId)
      .in("id", ids.slice(i, i + CHUNK));
    for (const s of data ?? []) {
      sources.push({ ...s, publisher: publisherOf(s.url, s.name), matches: detectTextSignals(s.title, s.summary).matches });
    }
  }
  sources.sort((a, b) => Date.parse(b.published_at ?? b.retrieved_at) - Date.parse(a.published_at ?? a.retrieved_at));

  return {
    trend: trend as TrendDetail["trend"],
    event: event.data ?? null,
    sources,
    opportunities: opportunities.data ?? [],
  };
}

/** Open opportunities per trend (one query) — "Create opportunity" becomes "Open opportunity". */
export async function openOpportunitiesByTrend(db: Db, projectId: string, trendIds: readonly string[]): Promise<Map<string, { id: string; status: string }>> {
  const out = new Map<string, { id: string; status: string }>();
  if (trendIds.length === 0) return out;
  const { data, error } = await db
    .from("opportunities")
    .select("id, status, trend_id, created_at")
    .eq("project_id", projectId)
    .in("trend_id", [...trendIds])
    .not("status", "in", "(rejected,archived)")
    .order("created_at", { ascending: false });
  if (error) {
    logger.warn("trends.opportunities_lookup_failed", { projectId, code: error.code });
    return out;
  }
  for (const o of data ?? []) if (o.trend_id && !out.has(o.trend_id)) out.set(o.trend_id, { id: o.id, status: o.status });
  return out;
}
