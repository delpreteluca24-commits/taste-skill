import type { Db, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

import { eventChanges, prepareEventRows, prepareSourceRows, type EventInsert, type IngestConnector, type SourceInsert } from "./ingest";
import { toConnectorConfig, type ConnectorFormInput } from "./schema";
import type { ConnectorRow, EventItem, FeedItem, IngestCounts } from "./types";

/**
 * Connectors domain service. Every function takes the database client first so
 * the web app (user client, RLS) and the worker (service role, RLS bypassed)
 * share it — which is why EVERY query is also filtered by project_id.
 */

type DbError = { code?: string; message: string };
type Result<T> = { data: T; error: null } | { data: null; error: DbError };

const LIST_COLUMNS =
  "id, project_id, name, kind, url, target, sport_id, config, credibility, default_license, enabled, fetch_interval_minutes, last_fetched_at, last_status, last_error, last_item_count, etag, last_modified, created_by, created_at, updated_at";

export async function listConnectors(db: Db, projectId: string): Promise<ConnectorRow[]> {
  const { data, error } = await db
    .from("connectors")
    .select(LIST_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("connectors.list_failed", { code: error.code, message: error.message });
    throw new Error("Could not load connectors");
  }
  return data ?? [];
}

export async function getConnector(db: Db, projectId: string, connectorId: string): Promise<ConnectorRow | null> {
  const { data, error } = await db
    .from("connectors")
    .select(LIST_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", connectorId)
    .maybeSingle();
  if (error) {
    logger.error("connectors.get_failed", { code: error.code, message: error.message });
    return null;
  }
  return data;
}

function toColumns(input: ConnectorFormInput) {
  return {
    name: input.name,
    kind: input.kind,
    url: input.url,
    target: input.target,
    sport_id: input.sportId ?? null,
    credibility: input.credibility ?? null,
    default_license: input.defaultLicense,
    fetch_interval_minutes: input.fetchIntervalMinutes,
    enabled: input.enabled,
    config: toConnectorConfig(input),
  };
}

export async function createConnector(db: Db, projectId: string, userId: string, input: ConnectorFormInput): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from("connectors")
    .insert({ ...toColumns(input), project_id: projectId, created_by: userId })
    .select("id")
    .single();
  return error ? { data: null, error } : { data, error: null };
}

export async function updateConnector(db: Db, projectId: string, connectorId: string, input: ConnectorFormInput): Promise<Result<{ id: string }>> {
  const current = await getConnector(db, projectId, connectorId);
  if (!current) return { data: null, error: { code: "P0001", message: "NOT_FOUND: connector not found" } };
  const columns = toColumns(input);
  // a different URL is a different resource: forget its HTTP validators and last outcome
  const reset =
    current.url !== columns.url || current.kind !== columns.kind
      ? { etag: null, last_modified: null, last_status: null, last_error: null, last_item_count: null }
      : {};
  const { data, error } = await db
    .from("connectors")
    .update({ ...columns, ...reset })
    .eq("project_id", projectId)
    .eq("id", connectorId)
    .select("id");
  if (error) return { data: null, error };
  if (!data?.length) return { data: null, error: { code: "P0001", message: "NOT_FOUND: connector not found" } };
  return { data: data[0], error: null };
}

export async function setConnectorEnabled(db: Db, projectId: string, connectorId: string, enabled: boolean): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from("connectors")
    .update({ enabled })
    .eq("project_id", projectId)
    .eq("id", connectorId)
    .select("id");
  if (error) return { data: null, error };
  if (!data?.length) return { data: null, error: { code: "P0001", message: "NOT_FOUND: connector not found" } };
  return { data: data[0], error: null };
}

/** Deletes the connector; ingested sources/events stay (their connector_id is cleared). */
export async function deleteConnector(db: Db, projectId: string, connectorId: string): Promise<Result<{ id: string }>> {
  const { data, error } = await db.from("connectors").delete().eq("project_id", projectId).eq("id", connectorId).select("id");
  if (error) return { data: null, error };
  if (!data?.length) return { data: null, error: { code: "P0001", message: "NOT_FOUND: connector not found" } };
  return { data: data[0], error: null };
}

/** connectorId → id of its pending/running fetch job (to resume <JobStatus> after a reload). */
export async function listActiveFetchJobs(db: Db, projectId: string): Promise<Record<string, string>> {
  const { data, error } = await db
    .from("jobs")
    .select("id, payload, created_at")
    .eq("project_id", projectId)
    .eq("type", "connector.fetch")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    logger.warn("connectors.active_jobs_failed", { code: error.code, message: error.message });
    return {};
  }
  const out: Record<string, string> = {};
  for (const job of data ?? []) {
    const connectorId = (job.payload as { connectorId?: unknown } | null)?.connectorId;
    if (typeof connectorId === "string" && !out[connectorId]) out[connectorId] = job.id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

const CHUNK = 100;
const chunks = <T>(list: readonly T[], size = CHUNK): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Content hashes of this project's sources among `hashes`. */
async function existingHashes(db: Db, projectId: string, hashes: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(hashes)) {
    const { data, error } = await db.from("sources").select("content_hash").eq("project_id", projectId).in("content_hash", part);
    if (error) throw new Error(`source dedupe lookup failed: ${error.message}`);
    for (const row of data ?? []) if (row.content_hash) found.add(row.content_hash);
  }
  return found;
}

/** Inserts sources, skipping (project_id, url) conflicts. Returns how many rows were new. */
async function insertSources(db: Db, rows: SourceInsert[]): Promise<{ inserted: number; failed: number }> {
  let inserted = 0;
  let failed = 0;
  for (const part of chunks(rows)) {
    const { data, error } = await db.from("sources").upsert(part, { onConflict: "project_id,url", ignoreDuplicates: true }).select("id");
    if (!error) {
      inserted += data?.length ?? 0;
      continue;
    }
    // one bad row fails the whole batch: retry row by row to keep the good ones
    logger.warn("connectors.ingest_batch_failed", { code: error.code, message: error.message, rows: part.length });
    for (const row of part) {
      const single = await db.from("sources").upsert(row, { onConflict: "project_id,url", ignoreDuplicates: true }).select("id");
      if (single.error) {
        failed += 1;
        logger.warn("connectors.ingest_row_failed", { code: single.error.code, message: single.error.message });
      } else inserted += single.data?.length ?? 0;
    }
  }
  return { inserted, failed };
}

async function ingestSources(db: Db, projectId: string, connector: IngestConnector, items: readonly FeedItem[]): Promise<IngestCounts> {
  const prepared = prepareSourceRows(projectId, connector, items);
  const known = await existingHashes(db, projectId, prepared.rows.map((r) => r.content_hash as string));
  const fresh = prepared.rows.filter((r) => !known.has(r.content_hash as string));
  const { inserted, failed } = await insertSources(db, fresh);
  return {
    fetched: items.length,
    inserted,
    updated: 0,
    // in-batch repeats + known hashes + URL conflicts
    duplicates: prepared.duplicates + (prepared.rows.length - fresh.length) + (fresh.length - inserted - failed),
    errors: prepared.errors + failed,
  };
}

type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
type StoredEvent = Pick<Tables<"events">, "id" | "external_id" | "title" | "starts_at" | "ends_at" | "competition" | "venue" | "status" | "sport_id" | "connector_id">;

async function ingestEvents(db: Db, projectId: string, connector: IngestConnector, items: readonly EventItem[]): Promise<IngestCounts> {
  const prepared = prepareEventRows(projectId, connector, items);
  const counts: IngestCounts = { fetched: items.length, inserted: 0, updated: 0, duplicates: prepared.duplicates, errors: prepared.errors };

  const stored = new Map<string, StoredEvent>();
  for (const part of chunks(prepared.rows.map((r) => r.external_id as string))) {
    const { data, error } = await db
      .from("events")
      .select("id, external_id, title, starts_at, ends_at, competition, venue, status, sport_id, connector_id")
      .eq("project_id", projectId)
      .in("external_id", part);
    if (error) throw new Error(`event lookup failed: ${error.message}`);
    for (const row of data ?? []) if (row.external_id) stored.set(row.external_id, row);
  }

  const toInsert: EventInsert[] = [];
  for (const row of prepared.rows) {
    const existing = stored.get(row.external_id as string);
    if (!existing) {
      toInsert.push(row);
      continue;
    }
    const changes: EventUpdate = { ...eventChanges(existing, row) };
    // keep the (ends_at >= starts_at) check satisfiable: times move together
    if ("starts_at" in changes || "ends_at" in changes) {
      changes.starts_at = row.starts_at ?? null;
      changes.ends_at = row.ends_at ?? null;
    }
    if (Object.keys(changes).length === 0) {
      counts.duplicates += 1;
      continue;
    }
    if (!existing.sport_id && connector.sport_id) changes.sport_id = connector.sport_id;
    if (!existing.connector_id) changes.connector_id = connector.id;
    const { error } = await db.from("events").update(changes).eq("project_id", projectId).eq("id", existing.id);
    if (error) {
      counts.errors += 1;
      logger.warn("connectors.event_update_failed", { code: error.code, message: error.message });
    } else counts.updated += 1;
  }

  for (const part of chunks(toInsert)) {
    const { data, error } = await db.from("events").insert(part).select("id");
    if (!error) {
      counts.inserted += data?.length ?? 0;
      continue;
    }
    logger.warn("connectors.event_batch_failed", { code: error.code, message: error.message, rows: part.length });
    for (const row of part) {
      const single = await db.from("events").insert(row).select("id");
      if (!single.error) counts.inserted += single.data?.length ?? 0;
      else if (single.error.code === "23505") counts.duplicates += 1; // inserted concurrently
      else {
        counts.errors += 1;
        logger.warn("connectors.event_row_failed", { code: single.error.code, message: single.error.message });
      }
    }
  }
  return counts;
}

/**
 * Writes parsed items for a connector: sources (deduped by canonical URL and by
 * content hash) or events (upserted by provider id). Only links, titles and
 * short summaries are stored — never full article text.
 */
export async function ingestItems(
  db: Db,
  projectId: string,
  connector: IngestConnector,
  items: readonly FeedItem[] | readonly EventItem[],
): Promise<IngestCounts> {
  if (connector.target === "events") return ingestEvents(db, projectId, connector, items as readonly EventItem[]);
  return ingestSources(db, projectId, connector, items as readonly FeedItem[]);
}

// ---------------------------------------------------------------------------
// Fetch bookkeeping (worker)
// ---------------------------------------------------------------------------

export type FetchOutcome =
  | { status: "ok"; itemCount: number; etag: string | null; lastModified: string | null }
  | { status: "not_modified"; etag: string | null; lastModified: string | null }
  | { status: "error"; error: string };

/** Records the latest fetch on the connector (scoped by project). */
export async function recordFetchOutcome(db: Db, projectId: string, connectorId: string, outcome: FetchOutcome, at = new Date()) {
  const base = { last_fetched_at: at.toISOString(), last_status: outcome.status };
  const patch =
    outcome.status === "ok"
      ? { ...base, last_error: null, last_item_count: outcome.itemCount, etag: outcome.etag, last_modified: outcome.lastModified }
      : outcome.status === "not_modified"
        ? { ...base, last_error: null, ...(outcome.etag ? { etag: outcome.etag } : {}), ...(outcome.lastModified ? { last_modified: outcome.lastModified } : {}) }
        : { ...base, last_error: outcome.error.slice(0, 500) };
  const { error } = await db.from("connectors").update(patch).eq("project_id", projectId).eq("id", connectorId);
  if (error) logger.warn("connectors.record_outcome_failed", { connectorId, code: error.code, message: error.message });
}

/**
 * Queues trend detection after new items arrived. One job per project per
 * 10-minute slot (idempotency key), so a burst of connector fetches → one run.
 */
export async function enqueueTrendsDetect(db: Db, projectId: string, createdBy: string | null, now = new Date()): Promise<"queued" | "already_queued" | "failed"> {
  const slot = Math.floor(now.getTime() / 600_000);
  const { error } = await db.from("jobs").insert({
    project_id: projectId,
    type: "trends.detect",
    payload: { sinceHours: 48 },
    priority: 45,
    idempotency_key: `trends.detect:${projectId}:${slot}`,
    created_by: createdBy,
  });
  if (!error) return "queued";
  if (error.code === "23505") return "already_queued";
  logger.warn("connectors.trends_enqueue_failed", { projectId, code: error.code, message: error.message });
  return "failed";
}
