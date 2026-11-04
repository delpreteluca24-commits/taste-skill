import type { Database, Json } from "@/types/database";

import { canonicalizeUrl, contentHash } from "./normalize";
import type { ConnectorRow, EventItem, FeedItem } from "./types";

/**
 * Pure part of ingestion: parsed items → database rows, with in-batch dedupe.
 * The service (lib/connectors/service.ts) adds the database dedupe and writes.
 *
 * RIGHTS-FIRST: a source row is a pointer to an article (link, title, short
 * summary, byline, tags). Rights start UNCHECKED and are classified per asset
 * in the Rights Center; the connector's default license is only a hint.
 */

export type SourceInsert = Database["public"]["Tables"]["sources"]["Insert"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

export type IngestConnector = Pick<ConnectorRow, "id" | "name" | "kind" | "url" | "target" | "sport_id" | "credibility" | "default_license">;

export type Prepared<T> = { rows: T[]; duplicates: number; errors: number };

/** published dates further in the future than this are treated as wrong */
const FUTURE_TOLERANCE_MS = 24 * 3600_000;

export function prepareSourceRows(
  projectId: string,
  connector: IngestConnector,
  items: readonly FeedItem[],
  now: Date = new Date(),
): Prepared<SourceInsert> {
  const rows: SourceInsert[] = [];
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  let duplicates = 0;
  let errors = 0;

  for (const item of items) {
    const url = canonicalizeUrl(item.url);
    if (!url || (!item.title && !item.summary)) {
      errors += 1;
      continue;
    }
    const hash = contentHash(item.title, item.summary);
    if (seenUrls.has(url) || seenHashes.has(hash)) {
      duplicates += 1;
      continue;
    }
    seenUrls.add(url);
    seenHashes.add(hash);

    const published = item.publishedAt && Date.parse(item.publishedAt) <= now.getTime() + FUTURE_TOLERANCE_MS ? item.publishedAt : null;
    const metadata: { [key: string]: Json } = { ingested_by: "connector" };
    if (item.categories.length) metadata.categories = item.categories.slice(0, 20);
    if (item.guid) metadata.guid = item.guid;

    rows.push({
      project_id: projectId,
      connector_id: connector.id,
      sport_id: connector.sport_id,
      name: connector.name.slice(0, 200),
      title: item.title,
      url,
      source_type: connector.kind === "rss" ? "rss" : "api",
      published_at: published,
      retrieved_at: now.toISOString(),
      summary: item.summary,
      author: item.author,
      credibility: connector.credibility,
      license_status: connector.default_license,
      content_hash: hash,
      metadata,
    });
  }
  return { rows, duplicates, errors };
}

/**
 * Provider ids are namespaced by the API host ("api.example.com:12345") so two
 * providers that both use numeric ids never overwrite each other's events,
 * while connectors of the same provider share them.
 */
export function namespacedExternalId(connectorUrl: string, externalId: string): string {
  let host = "unknown";
  try {
    host = new URL(connectorUrl).hostname.toLowerCase();
  } catch {
    // keep "unknown": the connector URL is validated on save
  }
  return `${host}:${externalId}`;
}

export function prepareEventRows(projectId: string, connector: IngestConnector, items: readonly EventItem[]): Prepared<EventInsert> {
  const rows: EventInsert[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let errors = 0;

  for (const item of items) {
    const title = item.title.trim().slice(0, 300);
    if (!title || !item.externalId.trim()) {
      errors += 1;
      continue;
    }
    const externalId = namespacedExternalId(connector.url, item.externalId.trim());
    if (seen.has(externalId)) {
      duplicates += 1;
      continue;
    }
    seen.add(externalId);

    const row: EventInsert = {
      project_id: projectId,
      connector_id: connector.id,
      sport_id: connector.sport_id,
      external_id: externalId,
      title,
      starts_at: item.startsAt,
      ends_at: item.startsAt && item.endsAt && item.endsAt < item.startsAt ? null : item.endsAt,
      competition: item.competition?.slice(0, 120) ?? null,
      venue: item.venue,
      metadata: { ingested_by: "connector" },
    };
    // unknown provider status: leave the column alone (DB default 'scheduled' on insert)
    if (item.status) row.status = item.status;
    rows.push(row);
  }
  return { rows, duplicates, errors };
}

type EventFields = Pick<EventInsert, "title" | "starts_at" | "ends_at" | "competition" | "venue" | "status">;

const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && Date.parse(a) === Date.parse(b));

/** Fields of `incoming` that differ from the stored event (only mapped fields are compared). */
export function eventChanges(existing: EventFields, incoming: EventInsert): Partial<EventFields> {
  const changes: Partial<EventFields> = {};
  if (incoming.title !== existing.title) changes.title = incoming.title;
  if (!sameInstant(existing.starts_at, incoming.starts_at)) changes.starts_at = incoming.starts_at ?? null;
  if (!sameInstant(existing.ends_at, incoming.ends_at)) changes.ends_at = incoming.ends_at ?? null;
  if ((incoming.competition ?? null) !== (existing.competition ?? null)) changes.competition = incoming.competition ?? null;
  if ((incoming.venue ?? null) !== (existing.venue ?? null)) changes.venue = incoming.venue ?? null;
  if (incoming.status && incoming.status !== existing.status) changes.status = incoming.status;
  return changes;
}
