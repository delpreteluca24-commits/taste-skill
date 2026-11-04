import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider, AIRequest } from "@/lib/ai/types";
import { parseRadarExplanation } from "@/lib/trends/metrics";
import { detectionRunningAhead, detectTrends, getTrendDetail, listTrends } from "@/lib/trends/service";
import type { Database } from "@/types/database";
import { createJobContext, type JobContext } from "@/workers/context";
import { handler as trendsDetectHandler } from "@/workers/handlers/trends-detect";

import { pool } from "./db";

/**
 * Trend Engine end to end against the running Supabase stack:
 *   - detectTrends runs with the SERVICE ROLE (as the worker does): every query
 *     must be scoped to the project, so another project's identical headlines
 *     are never read, clustered or linked
 *   - re-running on the same data creates nothing new (idempotent)
 *   - reads (/trends) run with a signed-in user's client (RLS + project filter)
 *   - AI labels go through a fake provider (no real API calls)
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };

async function signedInUser(): Promise<{ id: string; db: Db }> {
  const email = `trends-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
  return { id: data.user.id, db };
}

async function newProject(user: { id: string; db: Db }, name: string) {
  const { data, error } = await user.db
    .from("projects")
    .insert({ owner_id: user.id, name, slug: `trends-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.projects.push(data.id);
  return data.id;
}

const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

type Fixture = { key: string; title: string; host: string; hoursAgo: number | null; credibility?: number };

/** two stories + a standalone record + noise + an out-of-window duplicate */
const FIXTURES: Fixture[] = [
  { key: "b1", title: "Bologna stun Inter 3-0 at San Siro", host: "sport-one.example", hoursAgo: 1, credibility: 0.9 },
  { key: "b2", title: "Inter beaten 3-0 by Bologna in shock home defeat", host: "daily-two.example", hoursAgo: 2, credibility: 0.8 },
  { key: "b3", title: "Clamoroso a San Siro: il Bologna travolge l'Inter 3-0", host: "gazzetta-tre.example", hoursAgo: 3 },
  { key: "b4", title: "Bologna Stun Inter In Shock Win At San Siro", host: "www.news-four.example", hoursAgo: 4 },
  { key: "s1", title: "Jannik Sinner beats Carlos Alcaraz in Shanghai final", host: "tennis-five.example", hoursAgo: 5 },
  { key: "s2", title: "Sinner downs Alcaraz to win Shanghai Masters title", host: "sport-one.example", hoursAgo: 6 },
  { key: "s3", title: "Shanghai Masters: Sinner stuns Alcaraz in three sets", host: "daily-two.example", hoursAgo: null },
  { key: "r1", title: "Haaland breaks all-time Premier League scoring record", host: "news-four.example", hoursAgo: 8 },
  { key: "n1", title: "Napoli beat Lazio 2-1", host: "sport-one.example", hoursAgo: 9 },
  { key: "old", title: "Bologna stun Inter 3-0 at San Siro, again", host: "sport-one.example", hoursAgo: 100 },
];

async function seedSources(projectId: string, fixtures: Fixture[] = FIXTURES) {
  const ids: Record<string, string> = {};
  for (const f of fixtures) {
    const { data, error } = await admin
      .from("sources")
      .insert({
        project_id: projectId,
        name: f.host.replace(/^www\./, ""),
        title: f.title,
        url: `https://${f.host}/${projectId}/${f.key}-${randomUUID().slice(0, 8)}`,
        published_at: f.hoursAgo === null ? null : hoursAgo(f.hoursAgo),
        retrieved_at: hoursAgo(f.hoursAgo ?? 0.5),
        credibility: f.credibility ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    ids[f.key] = data.id;
  }
  return ids;
}

async function seedEvent(projectId: string, title = "Inter vs Bologna") {
  const { data, error } = await admin
    .from("events")
    .insert({ project_id: projectId, title, competition: "Serie A", status: "finished", starts_at: hoursAgo(4), ends_at: hoursAgo(2) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function trendsOf(projectId: string) {
  const { data, error } = await admin.from("trends").select("*").eq("project_id", projectId).order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

async function linksOf(projectId: string) {
  const { rows } = await pool.query<{ trend_id: string; source_id: string; source_project: string }>(
    `select ts.trend_id, ts.source_id, s.project_id as source_project
     from public.trend_sources ts join public.sources s on s.id = ts.source_id
     join public.trends t on t.id = ts.trend_id where t.project_id = $1`,
    [projectId],
  );
  return rows;
}

/** fake DISCOVERY model: names each cluster after its first headline; invents a name for the Sinner cluster (must be rejected) */
function fakeLabeller() {
  const complete = vi.fn(async (_model: string, request: AIRequest): Promise<AICallResult> => {
    const data = JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(request.messages[0].content)![1]) as {
      clusters: { cluster: string; headlines: { id: string; title: string }[] }[];
    };
    const labels = data.clusters.map((c) => {
      const sinner = c.headlines.some((h) => h.title.includes("Sinner"));
      return {
        cluster: c.cluster,
        title: sinner ? "Sinner beats Djokovic in Shanghai" : c.headlines[0].title,
        description: null,
        source_ids: [c.headlines[0].id],
      };
    });
    return {
      text: JSON.stringify({ labels }),
      usage: { inputTokens: 900, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: "claude-haiku-5-5",
      latencyMs: 5,
      stopReason: "end_turn",
    };
  });
  const provider: AIProvider = { id: "anthropic", isConfigured: () => true, complete };
  const router = createAIRouter({
    providers: { anthropic: provider },
    resolveConfig: () => ({ task: "discovery", primary: { provider: "anthropic", model: "claude-haiku-5-5" }, fallbacks: [], effort: "low", maxOutputTokens: 4000, source: "default" }),
  });
  return { router, complete };
}

let alice: { id: string; db: Db };
let bob: { id: string; db: Db };
let projectA = "";
let projectB = "";
let srcA: Record<string, string> = {};
let srcB: Record<string, string> = {};
let eventA = "";
let eventB = "";

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  projectA = await newProject(alice, "Trends A");
  projectB = await newProject(bob, "Trends B");
  srcA = await seedSources(projectA);
  // project B carries the SAME headlines and the same fixture: never to be mixed with A
  srcB = await seedSources(projectB, FIXTURES.slice(0, 4));
  eventA = await seedEvent(projectA);
  eventB = await seedEvent(projectB);
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe("detectTrends (service role, project-scoped)", () => {
  let first: Awaited<ReturnType<typeof detectTrends>>;

  it("clusters the window's sources into trends with explained metrics", async () => {
    first = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW });
    expect(first).toMatchObject({
      sourcesScanned: 9, // "old" is outside the 48h window
      trendsCreated: 3, // Bologna–Inter, Sinner–Alcaraz, Haaland record (strong signal, single source)
      trendsUpdated: 0,
      sourcesLinked: 8,
      unclustered: 1, // "Napoli beat Lazio 2-1": one source, no strong signal
      ai: { status: "skipped" },
    });

    const trends = await trendsOf(projectA);
    expect(trends).toHaveLength(3);
    const links = await linksOf(projectA);
    expect(links).toHaveLength(8);
    expect(links.every((l) => l.source_project === projectA)).toBe(true);
    expect(links.map((l) => l.source_id)).not.toContain(srcA.old);
    expect(links.map((l) => l.source_id)).not.toContain(srcA.n1);

    const bologna = trends.find((t) => links.filter((l) => l.trend_id === t.id).some((l) => l.source_id === srcA.b1))!;
    expect(links.filter((l) => l.trend_id === bologna.id).map((l) => l.source_id).sort()).toEqual([srcA.b1, srcA.b2, srcA.b3, srcA.b4].sort());
    expect(bologna).toMatchObject({
      project_id: projectA,
      event_id: eventA, // obvious fixture link — never B's identical event
      source_count: 4,
      volume: 4,
      publisher_count: 4, // "www." is the same publisher
      status: "rising",
    });
    expect(bologna.signals).toEqual(expect.arrayContaining(["just_finished", "upset", "rising_trend"]));
    expect(bologna.keywords.length).toBeGreaterThan(0);
    expect(Number(bologna.trend_score)).toBeGreaterThan(0);
    expect(Number(bologna.curiosity_score)).toBeGreaterThanOrEqual(60);
    expect(bologna.competition_level).toBeTruthy();
    expect((bologna.metadata as { title_origin: string }).title_origin).toBe("heuristic");

    const explanation = parseRadarExplanation(bologna.radar_explanation);
    expect(explanation).not.toBeNull();
    expect(explanation!.interest.factors.map((f) => f.key)).toEqual(["volume", "publishers", "momentum", "recency", "credibility"]);
    expect(explanation!.radar.score).toBe(Number(bologna.radar_score));
    expect(explanation!.curiosity.factors.find((f) => f.signal === "upset")?.terms).toEqual(expect.arrayContaining(["clamoroso", "shock"]));
  });

  it("stores each source's text signals (explainable, EN + IT)", async () => {
    const { data } = await admin.from("sources").select("id, signals").in("id", [srcA.b3, srcA.r1, srcA.n1]);
    const byId = new Map(data!.map((s) => [s.id, s.signals]));
    expect(byId.get(srcA.b3)).toContain("upset"); // "clamoroso"
    expect(byId.get(srcA.r1)).toContain("record");
    expect(byId.get(srcA.n1)).toEqual([]);
    expect(first.signalsUpdated).toBeGreaterThan(0);
  });

  it("never reads another project's sources or events", async () => {
    expect(await trendsOf(projectB)).toEqual([]);
    const { count } = await admin.from("trend_sources").select("source_id", { count: "exact", head: true }).in("source_id", Object.values(srcB));
    expect(count).toBe(0);
    const { data } = await admin.from("sources").select("signals").eq("project_id", projectB);
    expect(data!.every((s) => s.signals.length === 0)).toBe(true); // B's sources were not even touched
  });

  it("is idempotent: re-running on the same data creates nothing", async () => {
    const before = await trendsOf(projectA);
    const again = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW });
    expect(again).toMatchObject({ trendsCreated: 0, sourcesLinked: 0, trendsUpdated: 3, signalsUpdated: 0 });
    const after = await trendsOf(projectA);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
    expect(await linksOf(projectA)).toHaveLength(8);
    for (const t of after) {
      const b = before.find((x) => x.id === t.id)!;
      expect({ score: t.radar_score, status: t.status, title: t.title, count: t.source_count }).toEqual({
        score: b.radar_score,
        status: b.status,
        title: b.title,
        count: b.source_count,
      });
    }
  });

  it("a new source of the same story joins the existing trend", async () => {
    const ids = await seedSources(projectA, [{ key: "b5", title: "Inter fans stunned after Bologna win 3-0 at San Siro", host: "radio-six.example", hoursAgo: 0.5 }]);
    const res = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW });
    expect(res).toMatchObject({ trendsCreated: 0, sourcesLinked: 1 });
    const link = (await linksOf(projectA)).find((l) => l.source_id === ids.b5)!;
    const trend = (await trendsOf(projectA)).find((t) => t.id === link.trend_id)!;
    expect(trend.source_count).toBe(5);
    expect(trend.event_id).toBe(eventA);
  });

  it("expires trends without a new source for 72h", async () => {
    const { data: stale } = await admin
      .from("trends")
      .insert({ project_id: projectA, title: "Old story", status: "peaking", last_seen_at: hoursAgo(80), is_sweet_spot: true })
      .select("id")
      .single();
    const res = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW });
    expect(res.trendsExpired).toBeGreaterThanOrEqual(1);
    const { data } = await admin.from("trends").select("status, is_sweet_spot").eq("id", stale!.id).single();
    expect(data).toEqual({ status: "expired", is_sweet_spot: false });
  });

  it("project B gets its own trend from its own sources only", async () => {
    const res = await detectTrends(admin, projectB, { sinceHours: 48, now: NOW });
    expect(res).toMatchObject({ trendsCreated: 1, sourcesLinked: 4 });
    const [trend] = await trendsOf(projectB);
    expect(trend.event_id).toBe(eventB);
    const links = await linksOf(projectB);
    expect(links.every((l) => l.source_project === projectB)).toBe(true);
    expect((await trendsOf(projectA)).length).toBe(4); // 3 detected + the expired one, unchanged
  });

  it("links the event most of a story's sources already point to (even when its title does not match)", async () => {
    const { data: ev } = await admin
      .from("events")
      .insert({ project_id: projectB, title: "Ryder Cup, day one", status: "live", starts_at: hoursAgo(5) })
      .select("id")
      .single();
    const ids = await seedSources(projectB, [
      { key: "rc1", title: "Europe lead after foursomes at Bethpage", host: "golf-one.example", hoursAgo: 1 },
      { key: "rc2", title: "Europe dominate the foursomes at Bethpage", host: "golf-two.example", hoursAgo: 2 },
    ]);
    await admin.from("sources").update({ event_id: ev!.id }).in("id", [ids.rc1, ids.rc2]);
    const res = await detectTrends(admin, projectB, { sinceHours: 48, now: NOW });
    expect(res.trendsCreated).toBe(1);
    const trend = (await trendsOf(projectB)).find((t) => t.event_id === ev!.id)!;
    expect(trend.signals).toContain("upcoming_event"); // live event → upcoming_event ("live now")
    expect(trend.metadata).toMatchObject({ event_match: { via: "sources" } });
  });
});

describe("AI labels (DISCOVERY task, fake provider)", () => {
  it("accepts grounded labels, rejects invented names, never re-sends unchanged trends", async () => {
    const { router, complete } = fakeLabeller();
    const res = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW, ai: router });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(res.ai).toMatchObject({ status: "labelled", labelled: 2, rejected: 1, model: "claude-haiku-5-5" });

    const trends = await trendsOf(projectA);
    const links = await linksOf(projectA);
    const trendOf = (sourceId: string) => trends.find((t) => t.id === links.find((l) => l.source_id === sourceId)!.trend_id)!;

    const record = trendOf(srcA.r1);
    expect(record.title).toBe("Haaland breaks all-time Premier League scoring record");
    const meta = record.metadata as { title_origin: string; heuristic_title: string; ai_label: { source_ids: string[] } };
    expect(meta.title_origin).toBe("ai");
    expect(meta.ai_label.source_ids).toEqual([srcA.r1]);

    const sinner = trendOf(srcA.s1);
    expect(sinner.title).not.toMatch(/Djokovic/);
    expect(sinner.metadata).toMatchObject({ title_origin: "heuristic", ai_label_attempt: { result: expect.stringMatching(/Djokovic/) } });

    // second run: AI-titled trends keep their title, the rejected one has no new source → no call
    const again = await detectTrends(admin, projectA, { sinceHours: 48, now: NOW, ai: router });
    expect(again.ai.status).toBe("skipped");
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await trendsOf(projectA)).find((t) => t.id === record.id)!.title).toBe(record.title);
  });
});

describe("worker handler trends.detect", () => {
  async function runningJob(projectId: string, lockedSecondsAgo = 0) {
    const { rows } = await pool.query(
      `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at)
       values ($1, 'trends.detect', '{"sinceHours":48}', 'running', 1, now() - make_interval(secs => $2), 'test', now()) returning *`,
      [projectId, lockedSecondsAgo],
    );
    return rows[0];
  }

  it("runs as trend_hunter, logs the activity and returns counts", async () => {
    const job = await runningJob(projectA);
    const ctx: JobContext = { ...createJobContext(admin, job), ai: async () => fakeLabeller().router };
    const result = (await trendsDetectHandler.run(ctx, { sinceHours: 48 })) as { trendsCreated: number; sourcesScanned: number };
    expect(result).toMatchObject({ trendsCreated: 0, sourcesScanned: 10 });

    const runs = await pool.query("select agent, status from public.agent_runs where project_id = $1", [projectA]);
    expect(runs.rows).toContainEqual({ agent: "trend_hunter", status: "completed" });
    const logs = await pool.query("select action, actor_type, agent from public.activity_logs where project_id = $1 and action = 'trends.detected'", [projectA]);
    expect(logs.rows).toContainEqual({ action: "trends.detected", actor_type: "agent", agent: "trend_hunter" });
    await pool.query("delete from public.jobs where id = $1", [job.id]);
  });

  it("waits while an earlier detection of the same project is running (other projects do not count)", async () => {
    const earlier = await runningJob(projectA, 60);
    const mine = await runningJob(projectA);
    const other = await runningJob(projectB, 120);
    expect(await detectionRunningAhead(admin, projectA, mine)).toBe(earlier.id);
    expect(await detectionRunningAhead(admin, projectA, earlier)).toBeNull();
    await expect(trendsDetectHandler.run(createJobContext(admin, mine), { sinceHours: 48 })).rejects.toThrow(/another trend detection is running/);
    // last attempt: completes as skipped instead of failing
    const last = { ...mine, attempts: mine.max_attempts };
    expect(await trendsDetectHandler.run(createJobContext(admin, last), { sinceHours: 48 })).toMatchObject({ skipped: true });
    await pool.query("delete from public.jobs where id = any($1)", [[earlier.id, mine.id, other.id]]);
  });
});

describe("reads with the signed-in user's client", () => {
  it("lists and opens the project's trends with sources, signals and explanation", async () => {
    const list = await listTrends(alice.db, projectA, {});
    expect(list.length).toBe(3); // expired hidden by default
    const scores = list.map((t) => Number(t.radar_score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await listTrends(alice.db, projectA, { status: "expired" })).map((t) => t.title)).toEqual(["Old story"]);
    expect((await listTrends(alice.db, projectA, { signal: "record" })).length).toBe(1);
    expect((await listTrends(alice.db, projectA, { search: "100%_" })).length).toBe(0);

    const bologna = list.find((t) => t.signals.includes("just_finished"))!;
    const detail = await getTrendDetail(alice.db, projectA, bologna.id);
    expect(detail!.sources).toHaveLength(5);
    expect(detail!.sources[0].publisher).toBe("radio-six.example"); // newest first
    expect(detail!.event?.id).toBe(eventA);
    expect(detail!.sources.find((s) => s.id === srcA.b3)!.matches.find((m) => m.signal === "upset")?.terms).toEqual(["clamoroso"]);
  });

  it("another project's member sees nothing (RLS + project filter)", async () => {
    const [trend] = await listTrends(alice.db, projectA, {});
    expect(await listTrends(bob.db, projectA, {})).toEqual([]);
    expect(await getTrendDetail(bob.db, projectA, trend.id)).toBeNull();
    // Alice asking for her trend under Bob's project id: project filter refuses it
    expect(await getTrendDetail(alice.db, projectB, trend.id)).toBeNull();
  });
});
