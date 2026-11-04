import type { Enums, Tables } from "@/lib/db/client";

/**
 * Items produced by the parsers, before ingestion. Articles keep only what the
 * Radar needs to point at a story: link, title, short summary, byline, tags —
 * never the article body or media (RIGHTS-FIRST).
 */
export type FeedItem = {
  title: string | null;
  /** absolute http(s) URL as published (ingestion canonicalizes it) */
  url: string;
  /** ISO timestamp */
  publishedAt: string | null;
  /** plain text, max SUMMARY_MAX_LENGTH chars */
  summary: string | null;
  author: string | null;
  categories: string[];
  guid: string | null;
};

export type EventStatus = Enums<"event_status">;

export type EventItem = {
  /** provider id as published (ingestion namespaces it per provider host) */
  externalId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  competition: string | null;
  venue: string | null;
  /** null = the provider's status was missing or not recognized */
  status: EventStatus | null;
};

export type FeedFormat = "rss" | "atom" | "rdf" | "json";

export type ParseResult<T> = {
  format: FeedFormat;
  /** feed/channel title when the document has one */
  title: string | null;
  items: T[];
  /** items dropped because a required field (link, title…) was missing or invalid */
  skipped: number;
};

export type ConnectorRow = Tables<"connectors">;
export type ConnectorKind = Enums<"connector_kind">;
export type ConnectorTarget = "sources" | "events";

/** Ingestion outcome of one fetch. */
export type IngestCounts = {
  /** items handed to ingestion (after parsing) */
  fetched: number;
  inserted: number;
  /** existing events whose fields changed (events target only) */
  updated: number;
  /** already known: same canonical URL / content hash / unchanged event */
  duplicates: number;
  /** rejected rows (invalid fields, database errors) */
  errors: number;
};

export const SUMMARY_MAX_LENGTH = 500;
/** never ingest more than this many items per fetch */
export const MAX_ITEMS_PER_FETCH = 200;

/** Thrown when the document is not a feed / not the configured JSON shape (not retryable). */
export class ConnectorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorParseError";
  }
}
