import type { Db, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { openOpportunitiesByTrend } from "@/lib/trends/service";

import { dayEndIso, dayStartIso, type EventInput, type RadarFilters } from "./schema";
import { JUST_FINISHED_WINDOW_HOURS, UPCOMING_WINDOW_HOURS } from "./signals";

/**
 * Sports Radar board for the active project. Not a news feed: it ranks
 * editorial opportunities by radar score (interest + curiosity + room to
 * stand out) and surrounds them with the schedule (upcoming / just finished).
 *
 * Every query filters by project_id, also when RLS already does (the same
 * functions are safe with the service role).
 */

type DbError = { code?: string; message: string };
export type ServiceResult<T> = { data: T; error: null } | { data: null; error: DbError };

const HOUR = 3_600_000;
export const SWEET_SPOT_LIMIT = 12;
export const BREAKING_LIMIT = 20;
export const EVENTS_LIMIT = 30;
/** statuses shown in "Upcoming events" (finished ones go to "Just finished") */
export const UPCOMING_STATUSES = ["scheduled", "live", "postponed"] as const satisfies readonly Tables<"events">["status"][];

const TREND_COLUMNS =
  "id, title, description, status, trend_score, curiosity_score, competition_level, radar_score, is_sweet_spot, signals, source_count, publisher_count, velocity, first_seen_at, last_seen_at, sport_id, event_id, metadata, sport:sports(name)";
const EVENT_COLUMNS =
  "id, title, description, sport_id, competition, starts_at, ends_at, venue, status, importance, connector_id, external_id, created_at, sport:sports(name)";

export type RadarTrend = Pick<
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
> & {
  sport: { name: string } | null;
  /** open (not rejected/archived) opportunity already created from this trend */
  opportunity: { id: string; status: string } | null;
};

export type RadarEvent = Pick<
  Tables<"events">,
  | "id"
  | "title"
  | "description"
  | "sport_id"
  | "competition"
  | "starts_at"
  | "ends_at"
  | "venue"
  | "status"
  | "importance"
  | "connector_id"
  | "external_id"
  | "created_at"
> & { sport: { name: string } | null };

export type RadarWindow = { from: string; to: string; custom: boolean };

export type DetectionState = {
  activeJobId: string | null;
  lastRun: { finishedAt: string | null; status: string; result: unknown } | null;
};

export type RadarBoard = {
  sweetSpot: RadarTrend[];
  breaking: RadarTrend[];
  upcoming: RadarEvent[];
  finished: RadarEvent[];
  windows: { upcoming: RadarWindow; finished: RadarWindow };
  /** active (non-expired) trends in the project, unfiltered: tells "no data" from "filtered out" */
  activeTrends: number;
  detection: DetectionState;
};

/**
 * Event windows. Default: upcoming = next 72h, just finished = last 24h.
 * A date range replaces them: upcoming = [max(now, from), to], finished = [from, min(now, to)].
 */
export function eventWindows(filters: RadarFilters, tz: string, now: Date): { upcoming: RadarWindow; finished: RadarWindow } {
  const t = now.getTime();
  const from = filters.from ? dayStartIso(filters.from, tz) : null;
  const to = filters.to ? dayEndIso(filters.to, tz) : null;
  const custom = Boolean(from || to);
  const nowIso = now.toISOString();
  if (!custom) {
    return {
      upcoming: { from: nowIso, to: new Date(t + UPCOMING_WINDOW_HOURS * HOUR).toISOString(), custom },
      finished: { from: new Date(t - JUST_FINISHED_WINDOW_HOURS * HOUR).toISOString(), to: nowIso, custom },
    };
  }
  const upFrom = from && from > nowIso ? from : nowIso;
  const upTo = to ?? new Date(Date.parse(upFrom) + UPCOMING_WINDOW_HOURS * HOUR).toISOString();
  const finTo = to && to < nowIso ? to : nowIso;
  const finFrom = from ?? new Date(Date.parse(finTo) - JUST_FINISHED_WINDOW_HOURS * HOUR).toISOString();
  return { upcoming: { from: upFrom, to: upTo, custom }, finished: { from: finFrom, to: finTo, custom } };
}

/** Trend query of the project with the board filters (expired hidden unless asked for). */
function trendQuery(db: Db, projectId: string, filters: RadarFilters, tz: string) {
  let q = db.from("trends").select(TREND_COLUMNS).eq("project_id", projectId);
  if (filters.trendStatus) q = q.eq("status", filters.trendStatus);
  else q = q.neq("status", "expired");
  if (filters.sportId) q = q.eq("sport_id", filters.sportId);
  if (filters.minScore !== undefined) q = q.gte("radar_score", filters.minScore);
  if (filters.competition) q = q.eq("competition_level", filters.competition);
  const from = filters.from ? dayStartIso(filters.from, tz) : null;
  const to = filters.to ? dayEndIso(filters.to, tz) : null;
  if (from) q = q.gte("last_seen_at", from);
  if (to) q = q.lt("last_seen_at", to);
  return q;
}

export async function getRadarBoard(db: Db, projectId: string, filters: RadarFilters, opts: { tz: string; now?: Date }): Promise<RadarBoard> {
  const now = opts.now ?? new Date();
  const windows = eventWindows(filters, opts.tz, now);

  const sweetQ = trendQuery(db, projectId, filters, opts.tz)
    .eq("is_sweet_spot", true)
    .order("radar_score", { ascending: false, nullsFirst: false })
    .order("last_seen_at", { ascending: false })
    .limit(SWEET_SPOT_LIMIT);
  // breaking & emerging: new or accelerating stories, or anything carrying a breaking signal
  const breakingQ = trendQuery(db, projectId, filters, opts.tz)
    .eq("is_sweet_spot", false)
    .or("status.in.(emerging,rising),signals.cs.{breaking}")
    .order("radar_score", { ascending: false, nullsFirst: false })
    .order("last_seen_at", { ascending: false })
    .limit(BREAKING_LIMIT);

  // the event status filter narrows each section to the statuses it can hold:
  // upcoming = scheduled / live / postponed, just finished = finished
  const upStatuses = UPCOMING_STATUSES.filter((s) => !filters.eventStatus || s === filters.eventStatus);
  const showFinished = !filters.eventStatus || filters.eventStatus === "finished";
  const none = Promise.resolve({ data: [] as unknown[], error: null });

  let upcomingQ = db
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("project_id", projectId)
    .in("status", upStatuses)
    .gte("starts_at", windows.upcoming.from)
    .lt("starts_at", windows.upcoming.to);
  // live events started before "now" but belong on top of the upcoming list (unless their end has passed)
  let liveQ = db
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "live")
    .lt("starts_at", windows.upcoming.to)
    .or(`ends_at.is.null,ends_at.gte.${now.toISOString()}`);
  let finishedQ = db
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "finished")
    .or(
      `and(ends_at.gte.${windows.finished.from},ends_at.lte.${windows.finished.to}),and(ends_at.is.null,starts_at.gte.${windows.finished.from},starts_at.lte.${windows.finished.to})`,
    );
  if (filters.sportId) {
    upcomingQ = upcomingQ.eq("sport_id", filters.sportId);
    liveQ = liveQ.eq("sport_id", filters.sportId);
    finishedQ = finishedQ.eq("sport_id", filters.sportId);
  }

  const [sweet, breaking, upcoming, live, finished, active, detection] = await Promise.all([
    sweetQ,
    breakingQ,
    upStatuses.length
      ? upcomingQ.order("starts_at", { ascending: true }).order("importance", { ascending: false, nullsFirst: false }).limit(EVENTS_LIMIT)
      : none,
    upStatuses.includes("live") ? liveQ.order("starts_at", { ascending: true }).limit(EVENTS_LIMIT) : none,
    showFinished
      ? finishedQ.order("ends_at", { ascending: false, nullsFirst: false }).order("starts_at", { ascending: false }).limit(EVENTS_LIMIT)
      : none,
    db.from("trends").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "expired"),
    getDetectionState(db, projectId),
  ]);
  for (const [name, res] of Object.entries({ sweet, breaking, upcoming, live, finished })) {
    if (res.error) {
      logger.error("radar.board_query_failed", { projectId, query: name, code: res.error.code, message: res.error.message });
      throw new Error("Could not load the radar board");
    }
  }

  const trends = [...(sweet.data ?? []), ...(breaking.data ?? [])] as unknown as Omit<RadarTrend, "opportunity">[];
  const opportunities = await openOpportunitiesByTrend(
    db,
    projectId,
    trends.map((t) => t.id),
  );
  const withOpp = (rows: unknown[] | null) =>
    ((rows ?? []) as Omit<RadarTrend, "opportunity">[]).map((t) => ({ ...t, opportunity: opportunities.get(t.id) ?? null }));

  const liveRows = (live.data ?? []) as unknown as RadarEvent[];
  const liveIds = new Set(liveRows.map((e) => e.id));
  const upcomingRows = [...liveRows, ...((upcoming.data ?? []) as unknown as RadarEvent[]).filter((e) => !liveIds.has(e.id))].slice(0, EVENTS_LIMIT);

  return {
    sweetSpot: withOpp(sweet.data),
    breaking: withOpp(breaking.data),
    upcoming: upcomingRows,
    finished: (finished.data ?? []) as unknown as RadarEvent[],
    windows,
    activeTrends: active.count ?? 0,
    detection,
  };
}

/** Latest trends.detect job of the project: a running one (to show progress) and the last finished one. */
export async function getDetectionState(db: Db, projectId: string): Promise<DetectionState> {
  const { data, error } = await db
    .from("jobs")
    .select("id, status, result, finished_at, created_at")
    .eq("project_id", projectId)
    .eq("type", "trends.detect")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    logger.warn("radar.detection_state_failed", { projectId, code: error.code });
    return { activeJobId: null, lastRun: null };
  }
  const active = (data ?? []).find((j) => j.status === "pending" || j.status === "running");
  const last = (data ?? []).find((j) => j.status === "completed" || j.status === "failed");
  return {
    activeJobId: active?.id ?? null,
    lastRun: last ? { finishedAt: last.finished_at, status: last.status, result: last.result } : null,
  };
}

export type MemberRole = Tables<"project_members">["role"];

/**
 * The signed-in user's role in the project (null = not a member). Only used to
 * hide forms people cannot submit: RLS still decides every write
 * (editor+ creates/updates, admin+ deletes).
 */
export async function getMemberRole(db: Db, projectId: string, userId: string): Promise<MemberRole | null> {
  const { data, error } = await db.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (error) {
    logger.warn("radar.member_role_failed", { projectId, code: error.code });
    return null;
  }
  return data?.role ?? null;
}

export const canEdit = (role: MemberRole | null) => role === "editor" || role === "admin" || role === "owner";
export const canDelete = (role: MemberRole | null) => role === "admin" || role === "owner";

/* ------------------------------------------------------------------------- */
/* events (manual entry)                                                     */
/* ------------------------------------------------------------------------- */

export async function getEvent(db: Db, projectId: string, id: string): Promise<RadarEvent | null> {
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error) {
    logger.error("radar.event_load_failed", { projectId, eventId: id, code: error.code });
    return null;
  }
  return (data as unknown as RadarEvent) ?? null;
}

export async function createEvent(db: Db, projectId: string, input: EventInput): Promise<ServiceResult<{ id: string }>> {
  const { data, error } = await db
    .from("events")
    .insert({ ...input, project_id: projectId, metadata: { entered_by: "manual" } })
    .select("id")
    .single();
  if (error) return { data: null, error };
  return { data, error: null };
}

export async function updateEvent(db: Db, projectId: string, id: string, input: EventInput): Promise<ServiceResult<{ id: string }>> {
  const { data, error } = await db.from("events").update(input).eq("id", id).eq("project_id", projectId).select("id").maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { code: "P0001", message: "NOT_FOUND: event not found" } };
  return { data, error: null };
}

/** Deleting needs the admin role (RLS); trends/sources linked to it keep existing (FK set null). */
export async function deleteEvent(db: Db, projectId: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const { data, error } = await db.from("events").delete().eq("id", id).eq("project_id", projectId).select("id").maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { code: "42501", message: "event not deleted (not found or not an admin)" } };
  return { data, error: null };
}
