import { parseConnectorConfig } from "@/lib/connectors/config";
import { parseJsonEvents, parseJsonSources } from "@/lib/connectors/parse-json-api";
import { parseFeed } from "@/lib/connectors/parse-rss";
import { enqueueTrendsDetect, ingestItems, recordFetchOutcome } from "@/lib/connectors/service";
import { ConnectorParseError, type ConnectorRow, type EventItem, type FeedItem, type ParseResult } from "@/lib/connectors/types";
import { cleanValidator, safeFetch, SafeFetchError } from "@/lib/net/safe-fetch";
import type { Json } from "@/types/database";

import { defineHandler, JobInputError, type JobContext } from "../context";

/**
 * connector.fetch — Sports Radar ingestion for one connector:
 * SSRF-safe conditional GET → parse (RSS/Atom/RDF or mapped JSON) → ingest
 * (links + summaries only; sources deduped by URL and content hash, events
 * upserted by provider id) → bookkeeping on the connector → trends.detect.
 *
 * No AI here: parsing is deterministic, so this job costs nothing to run.
 * Errors are recorded on the connector; transient ones (network, timeout, 5xx,
 * 429) rethrow for a retry, permanent ones (blocked URL, 4xx, not a feed,
 * bad mapping) fail the job without retrying — the next scheduled slot tries again.
 */

const ACCEPT: Record<ConnectorRow["kind"], string> = {
  rss: "application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1",
  json_api: "application/json, */*;q=0.1",
};

const RETRYABLE_HTTP = new Set([408, 425, 429]);

type FetchResult = {
  status: "ok" | "not_modified";
  format?: string;
  fetched: number;
  inserted: number;
  updated: number;
  duplicates: number;
  errors: number;
  trends?: string;
};

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "connector URL";
  }
}

async function fetchAndIngest(ctx: JobContext, connector: ConnectorRow): Promise<FetchResult> {
  /** records the failure on the connector, logs it, returns the error to throw */
  const failure = async (message: string, permanent: boolean) => {
    await recordFetchOutcome(ctx.db, ctx.projectId, connector.id, { status: "error", error: message });
    await ctx.activity({
      agent: "sports_radar",
      action: "connector.fetch_failed",
      entityType: "connector",
      entityId: connector.id,
      status: "failed",
      metadata: { connector: connector.name, error: message.slice(0, 300), willRetry: !permanent },
    });
    ctx.log("connector.fetch_failed", { connectorId: connector.id, permanent, message: message.slice(0, 200) });
    return permanent ? new JobInputError(message) : new Error(message);
  };

  // configuration problems are permanent: check before any network I/O
  if (connector.kind === "rss" && connector.target !== "sources") {
    throw await failure("RSS connectors can only create sources", true);
  }
  const config = connector.kind === "json_api" ? parseConnectorConfig(connector.target, connector.config) : null;
  if (config && !config.ok) throw await failure(`Invalid JSON mapping: ${config.error}`, true);

  let response;
  try {
    response = await safeFetch(connector.url, {
      etag: connector.etag,
      lastModified: connector.last_modified,
      accept: ACCEPT[connector.kind],
    });
  } catch (e) {
    if (e instanceof SafeFetchError) throw await failure(e.message, !e.retryable);
    throw await failure(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`, false);
  }

  if (response.notModified) {
    await recordFetchOutcome(ctx.db, ctx.projectId, connector.id, {
      status: "not_modified",
      etag: cleanValidator(response.headers.etag),
      lastModified: cleanValidator(response.headers["last-modified"]),
    });
    await ctx.activity({
      agent: "sports_radar",
      action: "connector.not_modified",
      entityType: "connector",
      entityId: connector.id,
      status: "info",
      metadata: { connector: connector.name },
    });
    return { status: "not_modified", fetched: 0, inserted: 0, updated: 0, duplicates: 0, errors: 0 };
  }

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500 && !RETRYABLE_HTTP.has(response.status);
    throw await failure(`HTTP ${response.status} from ${host(response.finalUrl)}`, permanent);
  }

  let parsed: ParseResult<FeedItem> | ParseResult<EventItem>;
  try {
    if (connector.kind === "rss") parsed = parseFeed(response.body, { baseUrl: response.finalUrl });
    else if (config?.ok && config.target === "events") parsed = parseJsonEvents(response.body, config.mapping);
    else if (config?.ok && config.target === "sources") parsed = parseJsonSources(response.body, config.mapping, { baseUrl: response.finalUrl });
    else throw new ConnectorParseError("No JSON mapping configured");
  } catch (e) {
    if (e instanceof ConnectorParseError) throw await failure(e.message, true);
    throw await failure(`Could not read the response: ${e instanceof Error ? e.message : String(e)}`, true);
  }

  let counts;
  try {
    counts = await ingestItems(ctx.db, ctx.projectId, connector, parsed.items);
  } catch (e) {
    throw await failure(`Ingestion failed: ${e instanceof Error ? e.message : String(e)}`, false);
  }

  const seen = parsed.items.length + parsed.skipped;
  await recordFetchOutcome(ctx.db, ctx.projectId, connector.id, {
    status: "ok",
    itemCount: seen,
    etag: cleanValidator(response.headers.etag),
    lastModified: cleanValidator(response.headers["last-modified"]),
  });

  const result: FetchResult = {
    status: "ok",
    format: parsed.format,
    fetched: seen,
    inserted: counts.inserted,
    updated: counts.updated,
    duplicates: counts.duplicates,
    // items the parser had to drop (no link/title) count as errors too
    errors: counts.errors + parsed.skipped,
  };

  // new material → let the Trend Hunter look at it (one job per project per 10-minute slot)
  if (counts.inserted > 0 || (connector.target === "events" && counts.updated > 0)) {
    result.trends = await enqueueTrendsDetect(ctx.db, ctx.projectId, ctx.job.created_by);
  }

  await ctx.activity({
    agent: "sports_radar",
    action: "connector.fetched",
    entityType: "connector",
    entityId: connector.id,
    status: result.errors > 0 && result.inserted === 0 && result.updated === 0 ? "warning" : "success",
    metadata: { connector: connector.name, target: connector.target, ...result },
  });
  ctx.log("connector.fetched", { connectorId: connector.id, ...result });
  return result;
}

export const handler = defineHandler({
  type: "connector.fetch",
  async run(ctx, payload) {
    const connector = await ctx.loadOwned("connectors", payload.connectorId);

    // scheduled runs (no creator) respect a connector disabled after they were queued;
    // a person's explicit "Fetch now" still runs
    if (!connector.enabled && !ctx.job.created_by) {
      ctx.log("connector.skipped_disabled", { connectorId: connector.id });
      return { status: "skipped", reason: "connector disabled" };
    }

    return ctx.withAgentRun("sports_radar", { connectorId: connector.id, kind: connector.kind, target: connector.target }, async () => {
      const result = await fetchAndIngest(ctx, connector);
      return { result: result as unknown as Json, output: result as unknown as Json };
    });
  },
});
