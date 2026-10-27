import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eventsMappingSchema } from "@/lib/connectors/config";
import { parseJsonEvents } from "@/lib/connectors/parse-json-api";
import { parseFeed } from "@/lib/connectors/parse-rss";
import { enqueueTrendsDetect, ingestItems, recordFetchOutcome } from "@/lib/connectors/service";
import type { ConnectorRow, EventItem } from "@/lib/connectors/types";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * ingestItems with the service-role client (as the worker runs it): dedupe by
 * canonical URL and content hash, event upserts by provider id, and project
 * scoping of every lookup (the service role bypasses RLS).
 */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ids = { users: [] as string[], projects: [] as string[] };
let projectA = "";
let projectB = "";

async function user() {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{}', '{}', now(), now())`,
    [id, `connectors-${id}@example.test`],
  );
  ids.users.push(id);
  return id;
}

async function project(owner: string) {
  const { rows } = await pool.query<{ id: string }>(
    "insert into public.projects (owner_id, name, slug) values ($1, 'Connectors', $2) returning id",
    [owner, `c-${randomUUID().slice(0, 8)}`],
  );
  ids.projects.push(rows[0].id);
  return rows[0].id;
}

async function connector(projectId: string, over: Partial<ConnectorRow> = {}): Promise<ConnectorRow> {
  const { data, error } = await admin
    .from("connectors")
    .insert({
      project_id: projectId,
      name: "Example Sport News",
      kind: "rss",
      url: `https://news.example.com/${randomUUID()}/rss.xml`,
      target: "sources",
      credibility: 0.7,
      default_license: "unknown",
      ...over,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

const rss = parseFeed(readFileSync(new URL("../fixtures/rss/football-rss2.xml", import.meta.url), "utf8"), {
  baseUrl: "https://news.example.com/football/rss.xml",
});

beforeAll(async () => {
  projectA = await project(await user());
  projectB = await project(await user());
});

afterAll(async () => {
  await pool.query("delete from public.jobs where project_id = any($1)", [ids.projects]);
  await pool.query("delete from public.projects where id = any($1)", [ids.projects]);
  await pool.query("delete from auth.users where id = any($1)", [ids.users]);
  await pool.end();
});

const sourcesOf = async (projectId: string) =>
  (
    await pool.query<{ url: string; title: string | null; rights_status: string; usable_in_production: boolean; source_type: string; connector_id: string | null; content_hash: string; summary: string | null }>(
      "select url, title, rights_status, usable_in_production, source_type, connector_id, content_hash, summary from public.sources where project_id = $1 order by url",
      [projectId],
    )
  ).rows;

describe("ingestItems — sources", () => {
  it("stores canonical links + summaries with UNCHECKED rights, deduping the syndicated copy", async () => {
    const feed = await connector(projectA);
    const counts = await ingestItems(admin, projectA, feed, rss.items);
    // 5 parsed items: the mirror copy has the same title+summary as item 1
    expect(counts).toEqual({ fetched: 5, inserted: 4, updated: 0, duplicates: 1, errors: 0 });

    const rows = await sourcesOf(projectA);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.url)).toContain("https://news.example.com/football/articles/northbridge-riverside"); // utm + fragment dropped
    expect(rows.map((r) => r.url)).toContain("https://news.example.com/football/articles/harbour-city-draw"); // trailing slash dropped
    for (const r of rows) {
      expect(r).toMatchObject({ rights_status: "unchecked", usable_in_production: false, source_type: "rss", connector_id: feed.id });
      expect(r.summary ?? "").not.toMatch(/FULL ARTICLE BODY/);
    }
  });

  it("skips everything on a second fetch (same URLs and hashes)", async () => {
    const feed = await connector(projectA);
    const counts = await ingestItems(admin, projectA, feed, rss.items);
    expect(counts).toMatchObject({ inserted: 0, duplicates: 5, errors: 0 });
    expect(await sourcesOf(projectA)).toHaveLength(4);
  });

  it("dedupes by URL even when the text changed, and by hash even when the URL changed", async () => {
    const feed = await connector(projectA);
    const [first] = rss.items;
    const counts = await ingestItems(admin, projectA, feed, [
      { ...first, summary: "Updated standfirst after the final whistle." }, // same URL, new hash
      { ...rss.items[2], url: "https://other.example.org/copy-of-transfer-story" }, // new URL, same hash
      { ...first, url: "https://news.example.com/football/articles/fresh", title: "Fresh story", summary: "New." },
    ]);
    expect(counts).toMatchObject({ inserted: 1, duplicates: 2, errors: 0 });
    expect((await sourcesOf(projectA)).map((r) => r.url)).toContain("https://news.example.com/football/articles/fresh");
  });

  it("never dedupes against another project's sources", async () => {
    const feedB = await connector(projectB);
    const counts = await ingestItems(admin, projectB, feedB, rss.items);
    expect(counts).toMatchObject({ inserted: 4, duplicates: 1 });
    expect(await sourcesOf(projectB)).toHaveLength(4);
    // project A is untouched
    expect(await sourcesOf(projectA)).toHaveLength(5);
  });

  it("keeps good rows when one row is rejected by the database", async () => {
    const feed = await connector(projectA);
    const longUrl = `https://news.example.com/${"x".repeat(2040)}`; // canonical URL > 2048 → rejected before insert
    const counts = await ingestItems(admin, projectA, feed, [
      { ...rss.items[0], url: longUrl, title: "Too long", summary: "x" },
      // Postgres text cannot hold NUL: fails the batch → retried row by row
      { ...rss.items[0], url: "https://news.example.com/nul-row", title: "Bad \u0000 title", summary: "nul" },
      { ...rss.items[0], url: "https://news.example.com/ok-row", title: "OK row", summary: "fine" },
    ]);
    expect(counts).toMatchObject({ fetched: 3, inserted: 1, errors: 2, duplicates: 0 });
    const urls = (await sourcesOf(projectA)).map((r) => r.url);
    expect(urls).toContain("https://news.example.com/ok-row");
    expect(urls).not.toContain("https://news.example.com/nul-row");
  });
});

describe("ingestItems — events", () => {
  const mapping = eventsMappingSchema.parse({
    itemsPath: "response.fixtures",
    titlePath: "teams.home.name,teams.away.name",
    startsAtPath: "kickoff",
    endsAtPath: "end",
    competitionPath: "league.name",
    venuePath: "venue.name",
    statusPath: "status",
    externalIdPath: "id",
  });
  const fixtures = parseJsonEvents(readFileSync(new URL("../fixtures/json/fixtures-events.json", import.meta.url), "utf8"), mapping);

  const eventsOf = async (projectId: string) =>
    (
      await pool.query<{ external_id: string; title: string; status: string; venue: string | null; starts_at: Date | null }>(
        "select external_id, title, status, venue, starts_at from public.events where project_id = $1 order by external_id",
        [projectId],
      )
    ).rows;

  it("inserts events with namespaced provider ids, then updates only what changed", async () => {
    const api = await connector(projectA, { kind: "json_api", target: "events", url: "https://api.example.com/v1/fixtures", config: mapping });
    expect(await ingestItems(admin, projectA, api, fixtures.items)).toEqual({ fetched: 4, inserted: 4, updated: 0, duplicates: 0, errors: 0 });

    const stored = await eventsOf(projectA);
    expect(stored.map((e) => e.external_id)).toEqual(["api.example.com:90001", "api.example.com:90002", "api.example.com:90003", "api.example.com:90004"]);
    expect(stored[3].status).toBe("scheduled"); // unknown provider status → DB default, not a guess

    // same payload again → nothing to do
    expect(await ingestItems(admin, projectA, api, fixtures.items)).toMatchObject({ inserted: 0, updated: 0, duplicates: 4 });

    // the provider reports a status change and a moved kick-off
    const changed: EventItem[] = fixtures.items.map((e) =>
      e.externalId === "90002" ? { ...e, status: "live", startsAt: "2026-10-13T15:00:00.000Z" } : e,
    );
    expect(await ingestItems(admin, projectA, api, changed)).toMatchObject({ inserted: 0, updated: 1, duplicates: 3 });
    const after = (await eventsOf(projectA)).find((e) => e.external_id === "api.example.com:90002")!;
    expect(after.status).toBe("live");
    expect(after.starts_at?.toISOString()).toBe("2026-10-13T15:00:00.000Z");
  });

  it("upserts per project: the same provider id in another project is a separate event", async () => {
    const api = await connector(projectB, { kind: "json_api", target: "events", url: "https://api.example.com/v1/fixtures", config: mapping });
    expect(await ingestItems(admin, projectB, api, fixtures.items.slice(0, 1))).toMatchObject({ inserted: 1 });
    expect(await eventsOf(projectB)).toHaveLength(1);
    expect(await eventsOf(projectA)).toHaveLength(4);
  });
});

describe("connector bookkeeping", () => {
  it("records outcomes scoped to the project", async () => {
    const feed = await connector(projectA);
    await recordFetchOutcome(admin, projectA, feed.id, { status: "ok", itemCount: 7, etag: '"abc"', lastModified: "Wed, 07 Oct 2026 21:00:00 GMT" });
    let row = (await pool.query("select last_status, last_item_count, etag, last_modified, last_error from public.connectors where id = $1", [feed.id])).rows[0];
    expect(row).toMatchObject({ last_status: "ok", last_item_count: 7, etag: '"abc"', last_error: null });

    await recordFetchOutcome(admin, projectA, feed.id, { status: "error", error: "HTTP 500 from news.example.com" });
    row = (await pool.query("select last_status, last_error, etag from public.connectors where id = $1", [feed.id])).rows[0];
    expect(row).toMatchObject({ last_status: "error", last_error: "HTTP 500 from news.example.com", etag: '"abc"' });

    // wrong project → no change
    await recordFetchOutcome(admin, projectB, feed.id, { status: "ok", itemCount: 1, etag: null, lastModified: null });
    row = (await pool.query("select last_status from public.connectors where id = $1", [feed.id])).rows[0];
    expect(row.last_status).toBe("error");
  });

  it("queues one trends.detect per project per 10-minute slot", async () => {
    const now = new Date("2026-10-08T10:03:00Z");
    expect(await enqueueTrendsDetect(admin, projectA, null, now)).toBe("queued");
    expect(await enqueueTrendsDetect(admin, projectA, null, new Date("2026-10-08T10:09:59Z"))).toBe("already_queued");
    expect(await enqueueTrendsDetect(admin, projectB, null, now)).toBe("queued");
    expect(await enqueueTrendsDetect(admin, projectA, null, new Date("2026-10-08T10:10:00Z"))).toBe("queued");
    const jobs = await pool.query("select payload from public.jobs where project_id = $1 and type = 'trends.detect'", [projectA]);
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows[0].payload).toEqual({ sinceHours: 48 });
  });
});
