import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handler } from "@/workers/handlers/connector-fetch";
import { runJob, type HandlerMap } from "@/workers/runner";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * connector.fetch end to end: a real HTTP server on loopback (allowed only via the
 * dev flag ALLOW_PRIVATE_FETCH=1), the real handler, the service-role client.
 */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const handlers: HandlerMap = { "connector.fetch": handler };

const RSS = readFileSync(new URL("../fixtures/rss/football-rss2.xml", import.meta.url), "utf8");
const EVENTS = readFileSync(new URL("../fixtures/json/fixtures-events.json", import.meta.url), "utf8");

const ids = { users: [] as string[], projects: [] as string[] };
let projectA = "";
let projectB = "";
let server: http.Server;
let base = "";
let previousFlag: string | undefined;

beforeAll(async () => {
  previousFlag = process.env.ALLOW_PRIVATE_FETCH;
  process.env.ALLOW_PRIVATE_FETCH = "1";
  server = http.createServer((req, res) => {
    switch (new URL(req.url ?? "/", "http://localhost").pathname) {
      case "/feed.xml":
        if (req.headers["if-none-match"] === '"v1"') {
          res.writeHead(304, { etag: '"v1"' });
          return void res.end();
        }
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", etag: '"v1"', "last-modified": "Wed, 07 Oct 2026 21:10:00 GMT" });
        return void res.end(RSS);
      case "/fixtures.json":
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(EVENTS);
      case "/page.html":
        res.writeHead(200, { "content-type": "text/html" });
        return void res.end("<html><body>not a feed</body></html>");
      case "/down":
        res.writeHead(503);
        return void res.end();
      default:
        res.writeHead(404);
        return void res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  projectA = await project(await user());
  projectB = await project(await user());
});

afterAll(async () => {
  if (previousFlag === undefined) delete process.env.ALLOW_PRIVATE_FETCH;
  else process.env.ALLOW_PRIVATE_FETCH = previousFlag;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("delete from public.jobs where project_id = any($1)", [ids.projects]);
  await pool.query("delete from public.projects where id = any($1)", [ids.projects]);
  await pool.query("delete from auth.users where id = any($1)", [ids.users]);
  await pool.end();
});

async function user() {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{}', '{}', now(), now())`,
    [id, `connector-worker-${id}@example.test`],
  );
  ids.users.push(id);
  return id;
}

async function project(owner: string) {
  const { rows } = await pool.query<{ id: string }>("insert into public.projects (owner_id, name, slug) values ($1, 'CW', $2) returning id", [
    owner,
    `cw-${randomUUID().slice(0, 8)}`,
  ]);
  ids.projects.push(rows[0].id);
  return rows[0].id;
}

async function connector(projectId: string, url: string, extra: Record<string, unknown> = {}) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.connectors (project_id, name, kind, url, target, config, enabled)
     values ($1, 'Test feed', $2, $3, $4, $5, $6) returning id`,
    [projectId, extra.kind ?? "rss", url, extra.target ?? "sources", JSON.stringify(extra.config ?? {}), extra.enabled ?? true],
  );
  return rows[0].id;
}

/** a job already claimed by a worker (status running); created_by null = scheduled run */
async function runningJob(projectId: string, connectorId: string) {
  const { rows } = await pool.query(
    `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at)
     values ($1, 'connector.fetch', $2, 'running', 1, now(), 'test', now()) returning *`,
    [projectId, JSON.stringify({ connectorId })],
  );
  return rows[0];
}

const jobState = async (id: string) =>
  (await pool.query<{ status: string; error_message: string | null; result: Record<string, unknown> | null }>(
    "select status, error_message, result from public.jobs where id = $1",
    [id],
  )).rows[0];

const connectorState = async (id: string) =>
  (await pool.query("select last_status, last_error, last_item_count, etag, last_modified, last_fetched_at from public.connectors where id = $1", [id])).rows[0];

describe("connector.fetch handler", () => {
  it("fetches an RSS feed, ingests links + summaries, records the fetch and queues trend detection", async () => {
    const id = await connector(projectA, `${base}/feed.xml`);
    const job = await runningJob(projectA, id);
    expect(await runJob(admin, handlers, job)).toBe("completed");

    const state = await jobState(job.id);
    expect(state.result).toMatchObject({ status: "ok", format: "rss", fetched: 7, inserted: 4, duplicates: 1, errors: 2, trends: "queued" });
    expect(await connectorState(id)).toMatchObject({ last_status: "ok", last_error: null, last_item_count: 7, etag: '"v1"', last_modified: "Wed, 07 Oct 2026 21:10:00 GMT" });

    const sources = await pool.query("select rights_status, connector_id from public.sources where project_id = $1", [projectA]);
    expect(sources.rows).toHaveLength(4);
    expect(sources.rows.every((s) => s.rights_status === "unchecked" && s.connector_id === id)).toBe(true);

    const trends = await pool.query("select status, payload from public.jobs where project_id = $1 and type = 'trends.detect'", [projectA]);
    expect(trends.rows).toHaveLength(1);

    const runs = await pool.query("select agent, status from public.agent_runs where project_id = $1", [projectA]);
    expect(runs.rows).toContainEqual({ agent: "sports_radar", status: "completed" });
    const log = await pool.query("select action, status, entity_id from public.activity_logs where project_id = $1 and action = 'connector.fetched'", [projectA]);
    expect(log.rows).toEqual([{ action: "connector.fetched", status: "success", entity_id: id }]);
  });

  it("sends the stored ETag and records 304 as not_modified", async () => {
    const [{ id }] = (await pool.query<{ id: string }>("select id from public.connectors where project_id = $1 and etag = '\"v1\"'", [projectA])).rows;
    const job = await runningJob(projectA, id);
    expect(await runJob(admin, handlers, job)).toBe("completed");
    expect((await jobState(job.id)).result).toMatchObject({ status: "not_modified", inserted: 0 });
    expect((await connectorState(id)).last_status).toBe("not_modified");
  });

  it("upserts events from a mapped JSON API", async () => {
    const id = await connector(projectA, `${base}/fixtures.json`, {
      kind: "json_api",
      target: "events",
      config: { itemsPath: "response.fixtures", titlePath: "teams.home.name,teams.away.name", startsAtPath: "kickoff", statusPath: "status", externalIdPath: "id" },
    });
    const job = await runningJob(projectA, id);
    expect(await runJob(admin, handlers, job)).toBe("completed");
    expect((await jobState(job.id)).result).toMatchObject({ status: "ok", format: "json", inserted: 4, errors: 3 });
    const events = await pool.query("select title from public.events where project_id = $1 and connector_id = $2 order by external_id", [projectA, id]);
    expect(events.rows[0].title).toBe("Northbridge FC vs Riverside United");
  });

  it("retries transient HTTP errors and records them on the connector", async () => {
    const id = await connector(projectA, `${base}/down`);
    const job = await runningJob(projectA, id);
    expect(await runJob(admin, handlers, job)).toBe("failed");
    expect((await jobState(job.id)).status).toBe("pending"); // re-queued with backoff
    expect(await connectorState(id)).toMatchObject({ last_status: "error", last_error: expect.stringMatching(/HTTP 503/) });
    const runs = await pool.query("select status from public.agent_runs where project_id = $1 and status = 'failed'", [projectA]);
    expect(runs.rows.length).toBeGreaterThan(0);
  });

  it("fails permanently on 404, non-feed documents and invalid mappings", async () => {
    for (const [url, extra, message] of [
      [`${base}/missing.xml`, {}, /HTTP 404/],
      [`${base}/page.html`, {}, /Not an RSS, Atom or RDF feed/],
      [`${base}/fixtures.json?case=bad-mapping`, { kind: "json_api", target: "sources", config: { titlePath: "x" } }, /Invalid JSON mapping/],
    ] as const) {
      const id = await connector(projectA, url, extra);
      const job = await runningJob(projectA, id);
      expect(await runJob(admin, handlers, job)).toBe("failed");
      const state = await jobState(job.id);
      expect(state.status).toBe("failed");
      expect(state.error_message).toMatch(message);
      expect((await connectorState(id)).last_status).toBe("error");
    }
  });

  it("never fetches cloud metadata or other reserved addresses (even with the dev flag)", async () => {
    const id = await connector(projectA, "http://169.254.169.254/latest/meta-data/");
    const job = await runningJob(projectA, id);
    expect(await runJob(admin, handlers, job)).toBe("failed");
    const state = await jobState(job.id);
    expect(state.status).toBe("failed"); // permanent: no retries against a blocked target
    expect(state.error_message).toMatch(/not a public internet address/);
    expect((await connectorState(id)).last_status).toBe("error");
  });

  it("refuses a connector of another project", async () => {
    const foreign = await connector(projectB, `${base}/feed.xml`);
    const job = await runningJob(projectA, foreign);
    expect(await runJob(admin, handlers, job)).toBe("failed");
    expect((await jobState(job.id)).error_message).toMatch(/not found in this project/);
    expect((await connectorState(foreign)).last_fetched_at).toBeNull();
    const sources = await pool.query("select 1 from public.sources where project_id = $1", [projectB]);
    expect(sources.rows).toHaveLength(0);
  });

  it("skips scheduled runs of a disabled connector", async () => {
    const id = await connector(projectB, `${base}/feed.xml?case=disabled`, { enabled: false });
    const job = await runningJob(projectB, id);
    expect(await runJob(admin, handlers, job)).toBe("completed");
    expect((await jobState(job.id)).result).toMatchObject({ status: "skipped" });
    expect((await connectorState(id)).last_fetched_at).toBeNull();
  });
});
