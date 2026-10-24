import { cleanAuthor } from "./parse-rss";
import { cleanText, contentHash, parseDate } from "./normalize";
import type { EventsMapping, SourcesMapping } from "./config";
import {
  ConnectorParseError,
  MAX_ITEMS_PER_FETCH,
  SUMMARY_MAX_LENGTH,
  type EventItem,
  type EventStatus,
  type FeedItem,
  type ParseResult,
} from "./types";

export {
  dotPathSchema,
  eventsMappingSchema,
  parseConnectorConfig,
  sourcesMappingSchema,
  type EventsMapping,
  type SourcesMapping,
} from "./config";

/**
 * Generic JSON API connector: a config-driven mapping (connectors.config) turns
 * each item of a list into a source (article link) or an event (fixture).
 * Only mapped fields are read; nothing is inferred or invented. A broken item
 * is skipped and counted, never fatal.
 */

/** Own-property dot-path lookup ("data.items", "teams.0.name"); missing → undefined. */
export function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (typeof current === "object") {
      if (!Object.hasOwn(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Scalar → text; objects/arrays are not guessed at. */
function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function joinPaths(item: unknown, paths: string, separator: string): string | null {
  const parts = paths
    .split(",")
    .map((p) => cleanText(scalar(getPath(item, p.trim()))))
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(separator) : null;
}

function resolveLink(value: string | null, base: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const STATUS_SYNONYMS: Record<EventStatus, string[]> = {
  scheduled: ["scheduled", "not started", "notstarted", "ns", "tbd", "tba", "timed", "upcoming", "pre", "pre game", "pregame", "fixture", "pending", "confirmed"],
  live: ["live", "in play", "inplay", "in progress", "inprogress", "playing", "started", "ongoing", "1h", "2h", "ht", "half time", "halftime", "et", "break", "paused", "q1", "q2", "q3", "q4", "ot"],
  finished: ["finished", "ft", "full time", "fulltime", "final", "ended", "complete", "completed", "closed", "post", "post game", "aet", "pen", "after penalties", "awarded", "result"],
  postponed: ["postponed", "pst", "delayed", "suspended", "interrupted", "int", "susp", "rescheduled"],
  cancelled: ["cancelled", "canceled", "canc", "abandoned", "abd", "void", "called off"],
};
const STATUS_LOOKUP = new Map<string, EventStatus>(
  (Object.entries(STATUS_SYNONYMS) as [EventStatus, string[]][]).flatMap(([status, words]) => words.map((w) => [w, status])),
);

/** Provider status vocabulary → event_status; unknown → null (never guessed). */
export function mapEventStatus(value: unknown): EventStatus | null {
  const raw = scalar(value);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return STATUS_LOOKUP.get(key) ?? STATUS_LOOKUP.get(key.replace(/\s/g, "")) ?? null;
}

function parseJson(body: string): unknown {
  const text = body.replace(/^﻿/, "").trim();
  if (!text) throw new ConnectorParseError("Empty response: expected JSON");
  try {
    return JSON.parse(text);
  } catch {
    throw new ConnectorParseError("The response is not valid JSON");
  }
}

function itemsOf(doc: unknown, itemsPath: string | undefined): unknown[] {
  const list = getPath(doc, itemsPath);
  if (Array.isArray(list)) return list;
  if (!itemsPath) throw new ConnectorParseError("The response is not a list: set the items path (e.g. data.items)");
  throw new ConnectorParseError(`No list found at "${itemsPath}"`);
}

/** JSON → article items (target 'sources'). */
export function parseJsonSources(body: string, mapping: SourcesMapping, opts: { baseUrl?: string; maxItems?: number } = {}): ParseResult<FeedItem> {
  const raw = itemsOf(parseJson(body), mapping.itemsPath);
  const items: FeedItem[] = [];
  let skipped = 0;
  for (const entry of raw.slice(0, opts.maxItems ?? MAX_ITEMS_PER_FETCH)) {
    try {
      const url = resolveLink(scalar(getPath(entry, mapping.urlPath)), opts.baseUrl);
      const title = cleanText(joinPaths(entry, mapping.titlePath, " — "), 300);
      const summary = mapping.summaryPath ? cleanText(scalar(getPath(entry, mapping.summaryPath)), SUMMARY_MAX_LENGTH) : null;
      if (!url || (!title && !summary)) {
        skipped += 1;
        continue;
      }
      items.push({
        title,
        url,
        publishedAt: mapping.publishedAtPath ? parseDate(getPath(entry, mapping.publishedAtPath)) : null,
        summary,
        author: mapping.authorPath ? cleanAuthor(scalar(getPath(entry, mapping.authorPath))) : null,
        categories: [],
        guid: null,
      });
    } catch {
      skipped += 1;
    }
  }
  return { format: "json", title: null, items, skipped };
}

/** JSON → event items (target 'events'). */
export function parseJsonEvents(body: string, mapping: EventsMapping, opts: { maxItems?: number } = {}): ParseResult<EventItem> {
  const raw = itemsOf(parseJson(body), mapping.itemsPath);
  const items: EventItem[] = [];
  let skipped = 0;
  for (const entry of raw.slice(0, opts.maxItems ?? MAX_ITEMS_PER_FETCH)) {
    try {
      const title = cleanText(joinPaths(entry, mapping.titlePath, " vs "), 300);
      if (!title) {
        skipped += 1;
        continue;
      }
      const startsAt = mapping.startsAtPath ? parseDate(getPath(entry, mapping.startsAtPath)) : null;
      let endsAt = mapping.endsAtPath ? parseDate(getPath(entry, mapping.endsAtPath)) : null;
      if (startsAt && endsAt && endsAt < startsAt) endsAt = null; // inconsistent: keep only the start
      const providerId = mapping.externalIdPath ? scalar(getPath(entry, mapping.externalIdPath)) : null;
      if (mapping.externalIdPath && !providerId) {
        skipped += 1; // the mapping says items have ids: an item without one cannot be tracked
        continue;
      }
      items.push({
        // without an id mapping, a stable key derived from title + start time
        externalId: providerId ? providerId.slice(0, 200) : `h:${contentHash(title, startsAt ?? "").slice(0, 32)}`,
        title,
        startsAt,
        endsAt,
        competition: mapping.competitionPath ? cleanText(scalar(getPath(entry, mapping.competitionPath)), 120) : null,
        venue: mapping.venuePath ? cleanText(scalar(getPath(entry, mapping.venuePath)), 200) : null,
        status: mapping.statusPath ? mapEventStatus(getPath(entry, mapping.statusPath)) : null,
      });
    } catch {
      skipped += 1;
    }
  }
  return { format: "json", title: null, items, skipped };
}
