import type { Db, Enums, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import type { EditorialFormat } from "@/lib/rights/alternatives";
import type { ScoreComponentKey } from "@/lib/scoring/opportunity";
import type { Database, Json } from "@/types/database";

import type { ScoringContext, ScoringSource } from "./ai-scoring";
import {
  buildWhyNow,
  estimateComponents,
  type AssetRights,
  type EstimateInput,
  type EventFacts,
  type ResearchCounts,
  type RightsRoute,
  type SportFacts,
  type TrendFacts,
} from "./estimate";
import { escapeLike, type ManualOpportunityInput, type OpportunityFields, type OpportunityFilters } from "./schema";
import { applyManual, buildScoreColumns, clearComponent, mergeHeuristics, readRow } from "./scoring";

/**
 * Opportunity Engine — DB logic. Every function takes the DB client first, so
 * the same code runs as the signed-in user (RLS) and in the worker (service
 * role). Every query is ALSO filtered by the project id passed in.
 */

export type ServiceError = { code?: string; message?: string; details?: string | null; userMessage?: string };
export type ServiceResult<T> = { data: T; error: null } | { data: null; error: ServiceError };

const success = <T>(data: T): ServiceResult<T> => ({ data, error: null });
const failure = (error: ServiceError): ServiceResult<never> => ({ data: null, error });
const notFound = (what: string) => failure({ code: "P0001", message: `NOT_FOUND: ${what} not found` });

/** thrown inside a service function, turned into a ServiceResult at its boundary */
class QueryFailed extends Error {
  constructor(readonly error: ServiceError) {
    super(error.message ?? "query failed");
  }
}
function must<T>(res: { data: T; error: ServiceError | null }): T {
  if (res.error) throw new QueryFailed(res.error);
  return res.data;
}
/** for .single() / RPC rows: data is present whenever there is no error */
function mustOne<T>(res: { data: T; error: ServiceError | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new QueryFailed(res.error ?? { message: "no row returned" });
  return res.data as NonNullable<T>;
}
async function guarded<T>(event: string, fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QueryFailed) {
      logger.error(event, { code: e.error.code, message: e.error.message });
      return failure(e.error);
    }
    throw e;
  }
}

const TREND_COLUMNS =
  "id, title, description, sport_id, event_id, trend_score, curiosity_score, competition_level, publisher_count, source_count, signals, last_seen_at, status, is_sweet_spot, radar_score";
const EVENT_COLUMNS = "id, title, competition, starts_at, ends_at, status";
const SCORE_ROW_COLUMNS =
  "id, title, description, why_now, angle, hook, competition, status, signals, competition_level, sport_id, event_id, trend_id, metadata, trend_score, timeliness_score, curiosity_score, originality_score, audience_score, competition_gap_score, production_feasibility_score, rights_score, monetization_score, score_explanation";

type TrendRow = Pick<
  Tables<"trends">,
  | "id"
  | "title"
  | "description"
  | "sport_id"
  | "event_id"
  | "trend_score"
  | "curiosity_score"
  | "competition_level"
  | "publisher_count"
  | "source_count"
  | "signals"
  | "last_seen_at"
  | "status"
  | "is_sweet_spot"
  | "radar_score"
>;
type EventRow = Pick<Tables<"events">, "id" | "title" | "competition" | "starts_at" | "ends_at" | "status">;
export type ScoreRow = Pick<
  Tables<"opportunities">,
  | "id"
  | "title"
  | "description"
  | "why_now"
  | "angle"
  | "hook"
  | "competition"
  | "status"
  | "signals"
  | "competition_level"
  | "sport_id"
  | "event_id"
  | "trend_id"
  | "metadata"
  | "trend_score"
  | "timeliness_score"
  | "curiosity_score"
  | "originality_score"
  | "audience_score"
  | "competition_gap_score"
  | "production_feasibility_score"
  | "rights_score"
  | "monetization_score"
  | "score_explanation"
>;

function toTrendFacts(t: TrendRow): TrendFacts {
  return {
    title: t.title,
    trend_score: t.trend_score,
    curiosity_score: t.curiosity_score,
    competition_level: t.competition_level,
    publisher_count: t.publisher_count,
    source_count: t.source_count,
    signals: t.signals ?? [],
    last_seen_at: t.last_seen_at,
    status: t.status,
    is_sweet_spot: t.is_sweet_spot,
  };
}
function toEventFacts(e: EventRow | null): EventFacts | null {
  return e ? { title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, status: e.status } : null;
}

/* ------------------------------------------------------------------------- */
/* Loaders (each scoped to the project)                                      */
/* ------------------------------------------------------------------------- */

async function loadTrend(db: Db, projectId: string, trendId: string | null): Promise<TrendRow | null> {
  if (!trendId) return null;
  return must(await db.from("trends").select(TREND_COLUMNS).eq("id", trendId).eq("project_id", projectId).maybeSingle());
}

async function loadEvent(db: Db, projectId: string, eventId: string | null): Promise<EventRow | null> {
  if (!eventId) return null;
  return must(await db.from("events").select(EVENT_COLUMNS).eq("id", eventId).eq("project_id", projectId).maybeSingle());
}

/** sports are global reference data (no project) */
async function loadSport(db: Db, sportId: string | null): Promise<SportFacts | null> {
  if (!sportId) return null;
  return must(await db.from("sports").select("slug, name").eq("id", sportId).maybeSingle());
}

/** Research material on hand + which linked sources are media (footage) assets. */
async function loadResearch(db: Db, projectId: string, opportunityId: string) {
  const [items, facts] = await Promise.all([
    db.from("research_items").select("source_id, item_type").eq("opportunity_id", opportunityId).eq("project_id", projectId),
    db
      .from("facts")
      .select("id", { count: "exact", head: true })
      .eq("opportunity_id", opportunityId)
      .eq("project_id", projectId)
      .eq("status", "confirmed"),
  ]);
  const rows = must(items) ?? [];
  if (facts.error) throw new QueryFailed(facts.error);
  const sourceIds = [...new Set(rows.map((r) => r.source_id).filter((id): id is string => Boolean(id)))];
  const mediaSourceIds = [
    ...new Set(rows.filter((r) => r.source_id && (r.item_type === "video" || r.item_type === "media")).map((r) => r.source_id as string)),
  ];
  const counts: ResearchCounts = {
    sources: sourceIds.length,
    confirmedFacts: facts.count ?? 0,
    timelineItems: rows.filter((r) => r.item_type === "timeline").length,
  };
  return { counts, sourceIds, mediaSourceIds };
}

/**
 * STORY ≠ FOOTAGE: rights only matter for what production actually uses —
 * the stories' chosen formats, media sources (video/social) and the videos
 * behind this opportunity's clips. Articles used as references don't count.
 */
async function loadRightsRoute(db: Db, projectId: string, opportunityId: string, sourceIds: string[], mediaSourceIds: string[]): Promise<RightsRoute> {
  const [stories, contentItems, sources] = await Promise.all([
    db.from("stories").select("production_formats").eq("opportunity_id", opportunityId).eq("project_id", projectId),
    db.from("content_items").select("id").eq("opportunity_id", opportunityId).eq("project_id", projectId),
    sourceIds.length
      ? db.from("sources").select("id, source_type, rights_status, usable_in_production").in("id", sourceIds).eq("project_id", projectId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const formats = [...new Set((must(stories) ?? []).flatMap((s) => s.production_formats as EditorialFormat[]))];
  const assets: AssetRights[] = (must(sources) ?? [])
    .filter((s) => mediaSourceIds.includes(s.id) || s.source_type === "video" || s.source_type === "social")
    .map((s) => ({ status: s.rights_status, usable: s.usable_in_production }));

  const itemIds = (must(contentItems) ?? []).map((c) => c.id);
  if (itemIds.length) {
    const clips = must(await db.from("clips").select("video_id").in("content_item_id", itemIds).eq("project_id", projectId)) ?? [];
    const videoIds = [...new Set(clips.map((c) => c.video_id))];
    if (videoIds.length) {
      const videos = must(await db.from("videos").select("rights_status, usable_in_production").in("id", videoIds).eq("project_id", projectId)) ?? [];
      for (const v of videos) assets.push({ status: v.rights_status, usable: v.usable_in_production });
    }
  }
  return { productionFormats: formats, assets };
}

async function gatherEstimateInput(db: Db, projectId: string, row: ScoreRow, now: Date): Promise<EstimateInput> {
  const [trend, event, sport, research] = await Promise.all([
    loadTrend(db, projectId, row.trend_id),
    loadEvent(db, projectId, row.event_id),
    loadSport(db, row.sport_id),
    loadResearch(db, projectId, row.id),
  ]);
  const rights = await loadRightsRoute(db, projectId, row.id, research.sourceIds, research.mediaSourceIds);
  return {
    angle: row.angle,
    signals: row.signals ?? [],
    competitionLevel: row.competition_level,
    trend: trend ? toTrendFacts(trend) : null,
    event: toEventFacts(event),
    sport,
    research: research.counts,
    rights,
    now,
  };
}

async function loadScoreRow(db: Db, projectId: string, id: string): Promise<ScoreRow | null> {
  return must(
    await db.from("opportunities").select(SCORE_ROW_COLUMNS).eq("id", id).eq("project_id", projectId).maybeSingle(),
  );
}

type OpportunityUpdate = Database["public"]["Tables"]["opportunities"]["Update"];

/** returns null when the row is not visible/updatable (other project, RLS) */
async function writeColumns(db: Db, projectId: string, id: string, columns: OpportunityUpdate) {
  const updated = must(
    await db
      .from("opportunities")
      .update(columns)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle(),
  );
  return updated;
}

/* ------------------------------------------------------------------------- */
/* Create                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Trend → opportunity. The trend must belong to the project. Copies the trend's
 * signals/competition, links sport/event/trend, writes why-now from stored data,
 * seeds the research workspace with the trend's sources (type 'article') and
 * stores the heuristic score. Re-running for the same trend returns the open
 * opportunity instead of creating a duplicate.
 */
export async function createFromTrend(
  db: Db,
  args: { projectId: string; trendId: string; userId: string | null; now?: Date },
): Promise<ServiceResult<{ id: string; existing: boolean; researchItems: number }>> {
  return guarded<{ id: string; existing: boolean; researchItems: number }>("opportunities.create_from_trend_failed", async () => {
    const { projectId, trendId } = args;
    const now = args.now ?? new Date();
    const trend = await loadTrend(db, projectId, trendId);
    if (!trend) return notFound("trend");

    const existing = must(
      await db
        .from("opportunities")
        .select("id")
        .eq("project_id", projectId)
        .eq("trend_id", trendId)
        .not("status", "in", "(rejected,archived)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (existing) return success({ id: existing.id, existing: true, researchItems: 0 });

    const links = must(await db.from("trend_sources").select("source_id").eq("trend_id", trendId).eq("project_id", projectId)) ?? [];
    const sourceIds = links.map((l) => l.source_id);
    const [event, sport, sources] = await Promise.all([
      loadEvent(db, projectId, trend.event_id),
      loadSport(db, trend.sport_id),
      sourceIds.length
        ? db
            .from("sources")
            .select("id, name, title, url, published_at, source_type, rights_status, usable_in_production")
            .in("id", sourceIds)
            .eq("project_id", projectId)
            .order("published_at", { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const sourceRows = must(sources) ?? [];

    const facts = toTrendFacts(trend);
    const estimateInput: EstimateInput = {
      angle: null,
      signals: trend.signals ?? [],
      trend: facts,
      event: toEventFacts(event),
      sport,
      research: { sources: sourceRows.length, confirmedFacts: 0, timelineItems: 0 },
      rights: { productionFormats: [], assets: [] },
      now,
    };
    const { inputs, notes } = mergeHeuristics({}, estimateComponents(estimateInput));

    const created = mustOne(
      await db
        .from("opportunities")
        .insert({
          project_id: projectId,
          trend_id: trend.id,
          sport_id: trend.sport_id,
          event_id: trend.event_id,
          title: trend.title,
          description: trend.description,
          why_now: buildWhyNow({ trend: facts, event: toEventFacts(event), now }),
          competition: event?.competition ?? null,
          signals: trend.signals ?? [],
          competition_level: trend.competition_level,
          is_sweet_spot: trend.is_sweet_spot,
          created_by: args.userId,
          metadata: { created_from: "trend", trend_radar_score: trend.radar_score } as { [key: string]: Json },
          ...buildScoreColumns(inputs, notes),
        })
        .select("id")
        .single(),
    );

    let researchItems = 0;
    if (sourceRows.length) {
      const { error } = await db.from("research_items").insert(
        sourceRows.map((s, i) => ({
          project_id: projectId,
          opportunity_id: created.id,
          source_id: s.id,
          item_type: "article" as const,
          title: (s.title ?? s.name).slice(0, 500),
          url: s.url,
          occurred_at: s.published_at,
          position: i,
          created_by: args.userId,
          metadata: { added_from: "trend", publisher: s.name } as { [key: string]: Json },
        })),
      );
      // the opportunity stays usable without them: sources can be added in the research workspace
      if (error) logger.warn("opportunities.seed_research_failed", { opportunityId: created.id, code: error.code, message: error.message });
      else researchItems = sourceRows.length;
    }
    return success({ id: created.id, existing: false, researchItems });
  });
}

/** Manual opportunity (no trend): heuristics use what is known (sport, research, rights default). */
export async function createManual(
  db: Db,
  args: { projectId: string; userId: string | null; input: ManualOpportunityInput; now?: Date },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("opportunities.create_manual_failed", async () => {
    const { projectId, input } = args;
    const sport = await loadSport(db, input.sportId);
    if (input.sportId && !sport) return notFound("sport");
    const { inputs, notes } = mergeHeuristics(
      {},
      estimateComponents({ angle: input.angle, sport, research: { sources: 0, confirmedFacts: 0, timelineItems: 0 }, now: args.now }),
    );
    const created = mustOne(
      await db
        .from("opportunities")
        .insert({
          project_id: projectId,
          sport_id: input.sportId,
          title: input.title,
          description: input.description,
          why_now: input.why_now,
          angle: input.angle,
          hook: input.hook,
          competition: input.competition,
          created_by: args.userId,
          metadata: { created_from: "manual" } as { [key: string]: Json },
          ...buildScoreColumns(inputs, notes),
        })
        .select("id")
        .single(),
    );
    return success({ id: created.id });
  });
}

/* ------------------------------------------------------------------------- */
/* Edit + score                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Recompute heuristic components from the current data (research, rights,
 * event timing…). AI and manual components are kept as they are.
 */
export async function rescoreHeuristics(
  db: Db,
  args: { projectId: string; id: string; now?: Date },
): Promise<ServiceResult<{ id: string; score: number | null }>> {
  return guarded("opportunities.rescore_failed", async () => {
    const row = await loadScoreRow(db, args.projectId, args.id);
    if (!row) return notFound("opportunity");
    const estimates = estimateComponents(await gatherEstimateInput(db, args.projectId, row, args.now ?? new Date()));
    const { inputs, notes } = mergeHeuristics(readRow(row).inputs, estimates);
    const columns = buildScoreColumns(inputs, notes);
    if (!(await writeColumns(db, args.projectId, args.id, columns))) return notFound("opportunity");
    return success({ id: args.id, score: (columns.opportunity_score as number | null) ?? null });
  });
}

/** Edit editorial fields, then refresh heuristics (originality depends on the angle). */
export async function updateFields(
  db: Db,
  args: { projectId: string; id: string; fields: OpportunityFields },
): Promise<ServiceResult<{ id: string }>> {
  const res = await guarded("opportunities.update_failed", async () => {
    const updated = await writeColumns(db, args.projectId, args.id, { ...args.fields });
    return updated ? success({ id: args.id }) : notFound("opportunity");
  });
  if (res.error) return res;
  const rescored = await rescoreHeuristics(db, { projectId: args.projectId, id: args.id });
  return rescored.error ? rescored : res;
}

/** A human sets one component (origin 'manual'); the total is recomputed. */
export async function setComponent(
  db: Db,
  args: { projectId: string; id: string; component: ScoreComponentKey; value: number; reason: string },
): Promise<ServiceResult<{ id: string; score: number | null }>> {
  return guarded("opportunities.set_component_failed", async () => {
    const row = await loadScoreRow(db, args.projectId, args.id);
    if (!row) return notFound("opportunity");
    const { inputs, notes } = readRow(row);
    const columns = buildScoreColumns(applyManual(inputs, args.component, args.value, args.reason), notes);
    if (!(await writeColumns(db, args.projectId, args.id, columns))) return notFound("opportunity");
    return success({ id: args.id, score: (columns.opportunity_score as number | null) ?? null });
  });
}

/** Drop a manual/AI value: the component goes back to its heuristic estimate. */
export async function resetComponent(
  db: Db,
  args: { projectId: string; id: string; component: ScoreComponentKey; now?: Date },
): Promise<ServiceResult<{ id: string; score: number | null }>> {
  return guarded("opportunities.reset_component_failed", async () => {
    const row = await loadScoreRow(db, args.projectId, args.id);
    if (!row) return notFound("opportunity");
    const estimates = estimateComponents(await gatherEstimateInput(db, args.projectId, row, args.now ?? new Date()));
    const { inputs, notes } = mergeHeuristics(clearComponent(readRow(row).inputs, args.component), estimates);
    const columns = buildScoreColumns(inputs, notes);
    if (!(await writeColumns(db, args.projectId, args.id, columns))) return notFound("opportunity");
    return success({ id: args.id, score: (columns.opportunity_score as number | null) ?? null });
  });
}

/* ------------------------------------------------------------------------- */
/* Read                                                                      */
/* ------------------------------------------------------------------------- */

const LIST_COLUMNS =
  "id, title, why_now, status, opportunity_score, score_coverage, competition, competition_level, signals, is_sweet_spot, sport_id, trend_id, created_at, scored_at, sport:sports(name, slug)";

export type OpportunityListItem = Pick<
  Tables<"opportunities">,
  | "id"
  | "title"
  | "why_now"
  | "status"
  | "opportunity_score"
  | "score_coverage"
  | "competition"
  | "competition_level"
  | "signals"
  | "is_sweet_spot"
  | "sport_id"
  | "trend_id"
  | "created_at"
  | "scored_at"
> & { sport: { name: string; slug: string } | null };

/** Filtered list, best score first (unscored last). */
export async function listOpportunities(
  db: Db,
  projectId: string,
  filters: OpportunityFilters = {},
  limit = 200,
): Promise<ServiceResult<OpportunityListItem[]>> {
  return guarded("opportunities.list_failed", async () => {
    let q = db.from("opportunities").select(LIST_COLUMNS).eq("project_id", projectId);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.sportId) q = q.eq("sport_id", filters.sportId);
    if (filters.minScore !== undefined) q = q.gte("opportunity_score", filters.minScore);
    if (filters.sweetSpot) q = q.eq("is_sweet_spot", true);
    if (filters.signal) q = q.contains("signals", [filters.signal]);
    if (filters.search) q = q.ilike("title", `%${escapeLike(filters.search)}%`);
    const rows = must(
      await q
        .order("opportunity_score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return success(rows ?? []);
  });
}

export type LatestDecision = {
  decision: Enums<"approval_decision">;
  notes: string | null;
  createdAt: string;
  decidedBy: string | null;
};

export type OpportunityDetail = {
  opportunity: Tables<"opportunities">;
  trend: Pick<TrendRow, "id" | "title" | "status" | "trend_score" | "radar_score" | "last_seen_at" | "is_sweet_spot"> | null;
  event: EventRow | null;
  sport: SportFacts | null;
  research: ResearchCounts;
  latestDecision: LatestDecision | null;
  stories: Pick<Tables<"stories">, "id" | "title" | "status">[];
  contentItems: Pick<Tables<"content_items">, "id" | "title" | "stage">[];
};

export async function getOpportunityDetail(db: Db, projectId: string, id: string): Promise<ServiceResult<OpportunityDetail>> {
  return guarded("opportunities.detail_failed", async () => {
    const opportunity = must(await db.from("opportunities").select("*").eq("id", id).eq("project_id", projectId).maybeSingle());
    if (!opportunity) return notFound("opportunity");
    const [trend, event, sport, research, approval, stories, contentItems] = await Promise.all([
      loadTrend(db, projectId, opportunity.trend_id),
      loadEvent(db, projectId, opportunity.event_id),
      loadSport(db, opportunity.sport_id),
      loadResearch(db, projectId, id),
      db
        .from("approvals")
        .select("decision, notes, created_at, decided_by")
        .eq("project_id", projectId)
        .eq("entity_type", "opportunity")
        .eq("entity_id", id)
        .eq("checkpoint", "opportunity")
        .order("seq", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from("stories").select("id, title, status").eq("opportunity_id", id).eq("project_id", projectId).order("created_at"),
      db.from("content_items").select("id, title, stage").eq("opportunity_id", id).eq("project_id", projectId).order("created_at"),
    ]);
    const decision = must(approval);
    let decidedBy: string | null = null;
    if (decision) {
      const { data: person } = await db.from("users").select("display_name, email").eq("id", decision.decided_by).maybeSingle();
      decidedBy = person?.display_name || person?.email || null;
    }
    return success({
      opportunity,
      trend: trend
        ? {
            id: trend.id,
            title: trend.title,
            status: trend.status,
            trend_score: trend.trend_score,
            radar_score: trend.radar_score,
            last_seen_at: trend.last_seen_at,
            is_sweet_spot: trend.is_sweet_spot,
          }
        : null,
      event,
      sport,
      research: research.counts,
      latestDecision: decision ? { decision: decision.decision, notes: decision.notes, createdAt: decision.created_at, decidedBy } : null,
      stories: must(stories) ?? [],
      contentItems: must(contentItems) ?? [],
    });
  });
}

/** Rows + sport names + source titles the AI scorer needs (also used to estimate cost). */
export async function loadScoringBatch(
  db: Db,
  projectId: string,
  ids: string[],
): Promise<ServiceResult<{ rows: ScoreRow[]; contexts: Map<string, ScoringContext>; missing: string[] }>> {
  return guarded("opportunities.scoring_batch_failed", async () => {
    const unique = [...new Set(ids)];
    const rows = must(await db.from("opportunities").select(SCORE_ROW_COLUMNS).in("id", unique).eq("project_id", projectId)) ?? [];
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    const contexts = await loadScoringContexts(db, projectId, rows);
    return success({ rows, contexts, missing });
  });
}

export async function loadScoringContexts(db: Db, projectId: string, rows: Pick<ScoreRow, "id" | "sport_id">[]): Promise<Map<string, ScoringContext>> {
  const ids = rows.map((r) => r.id);
  const sportIds = [...new Set(rows.map((r) => r.sport_id).filter((s): s is string => Boolean(s)))];
  const [items, sports] = await Promise.all([
    ids.length
      ? db
          .from("research_items")
          .select("opportunity_id, source_id, title, position")
          .in("opportunity_id", ids)
          .eq("project_id", projectId)
          .not("source_id", "is", null)
          .order("position")
      : Promise.resolve({ data: [], error: null }),
    sportIds.length ? db.from("sports").select("id, name").in("id", sportIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const itemRows = must(items) ?? [];
  const sourceIds = [...new Set(itemRows.map((i) => i.source_id as string))];
  const sources = sourceIds.length
    ? (must(await db.from("sources").select("id, name, title").in("id", sourceIds).eq("project_id", projectId)) ?? [])
    : [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sportName = new Map((must(sports) ?? []).map((s) => [s.id, s.name]));

  const contexts = new Map<string, ScoringContext>();
  for (const row of rows) {
    const seen = new Set<string>();
    const list: ScoringSource[] = [];
    for (const item of itemRows) {
      if (item.opportunity_id !== row.id || !item.source_id || seen.has(item.source_id)) continue;
      const s = byId.get(item.source_id);
      if (!s) continue;
      seen.add(s.id);
      list.push({ id: s.id, title: s.title ?? item.title ?? s.name, publisher: s.name });
    }
    contexts.set(row.id, { sportName: row.sport_id ? (sportName.get(row.sport_id) ?? null) : null, sources: list });
  }
  return contexts;
}

/** AI scoring jobs still pending/running for this project (shown on the list page). */
export async function listActiveScoringJobs(db: Db, projectId: string): Promise<{ id: string; status: string; count: number }[]> {
  const { data, error } = await db
    .from("jobs")
    .select("id, status, payload")
    .eq("project_id", projectId)
    .eq("type", "opportunity.ai_score")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    logger.warn("opportunities.active_jobs_failed", { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((j) => ({
    id: j.id,
    status: j.status,
    count: Array.isArray((j.payload as { opportunityIds?: unknown })?.opportunityIds)
      ? ((j.payload as { opportunityIds: unknown[] }).opportunityIds.length ?? 0)
      : 0,
  }));
}

/* ------------------------------------------------------------------------- */
/* Human checkpoint + production                                             */
/* ------------------------------------------------------------------------- */

const IN_PRODUCTION: Enums<"opportunity_status">[] = ["production", "ready", "published"];

/**
 * OPPORTUNITY → APPROVAL through public.record_approval (records the decision
 * and sets the status atomically; refuses automated callers). Locked once
 * production has started.
 */
export async function decideOpportunity(
  db: Db,
  args: { projectId: string; id: string; decision: Enums<"approval_decision">; notes: string | null },
): Promise<ServiceResult<{ approvalId: string; status: Enums<"approval_decision"> }>> {
  return guarded("opportunities.decision_failed", async () => {
    const opp = must(await db.from("opportunities").select("id, status").eq("id", args.id).eq("project_id", args.projectId).maybeSingle());
    if (!opp) return notFound("opportunity");
    if (IN_PRODUCTION.includes(opp.status)) {
      return failure({ code: "DECISION_LOCKED", userMessage: "Production has started: the approval decision is locked." });
    }
    const approval = mustOne(
      await db.rpc("record_approval", {
        p_checkpoint: "opportunity",
        p_entity_id: args.id,
        p_decision: args.decision,
        ...(args.notes ? { p_notes: args.notes } : {}),
      }),
    );
    return success({ approvalId: approval.id, status: args.decision });
  });
}

/**
 * APPROVED opportunity → story + content item (stage 'research', format 'short'),
 * opportunity → 'production', atomically in public.start_production (row lock:
 * two concurrent clicks land on the same content item; no orphan stories).
 * Calling it again once production started returns the existing item.
 */
export async function startProduction(
  db: Db,
  args: { projectId: string; id: string; userId: string | null },
): Promise<ServiceResult<{ contentItemId: string; storyId: string | null; existing: boolean }>> {
  return guarded<{ contentItemId: string; storyId: string | null; existing: boolean }>("opportunities.start_production_failed", async () => {
    const { projectId, id } = args;
    const opp = must(await db.from("opportunities").select("id, status").eq("id", id).eq("project_id", projectId).maybeSingle());
    if (!opp) return notFound("opportunity");
    if (opp.status !== "approved" && !IN_PRODUCTION.includes(opp.status)) {
      return failure({ code: "NOT_APPROVED", userMessage: "Approve the opportunity before starting production." });
    }
    const rows = must(await db.rpc("start_production", { p_opportunity_id: id }));
    const row = rows?.[0];
    if (!row) throw new QueryFailed({ message: "start_production returned no row" });
    return success({ contentItemId: row.content_item_id, storyId: row.story_id, existing: row.existing });
  });
}
