import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider } from "@/lib/ai/types";
import {
  createFromTrend,
  createManual,
  decideOpportunity,
  getOpportunityDetail,
  listOpportunities,
  rescoreHeuristics,
  resetComponent,
  setComponent,
  startProduction,
  updateFields,
} from "@/lib/opportunities/service";
import type { ComponentExplanation } from "@/lib/scoring/opportunity";
import type { Database } from "@/types/database";
import { createJobContext, JobInputError, type JobContext } from "@/workers/context";
import { handler as aiScoreHandler } from "@/workers/handlers/opportunity-ai-score";

import { pool } from "./db";

/**
 * Opportunity Engine services against the running Supabase stack, called the
 * way the app calls them: with a SIGNED-IN user's client (RLS applies,
 * record_approval sees auth.uid()) and, for the worker, the service role.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };

async function signedInUser(): Promise<{ id: string; db: Db }> {
  const email = `opp-${randomUUID()}@example.test`;
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
    .insert({ owner_id: user.id, name, slug: `opp-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  created.projects.push(data.id);
  return data.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** trend with 3 sources and a finished event, created through RLS like connectors/radar would */
async function seedTrend(user: { db: Db }, projectId: string, title = "Bologna stun Inter 3-0 at San Siro") {
  const { data: sport } = await user.db.from("sports").select("id").eq("slug", "football").single();
  const { data: event, error: eventError } = await user.db
    .from("events")
    .insert({ project_id: projectId, sport_id: sport!.id, title: "Inter vs Bologna", competition: "Serie A", status: "finished", starts_at: hoursAgo(4), ends_at: hoursAgo(2) })
    .select("id")
    .single();
  if (eventError) throw new Error(eventError.message);
  const { data: trend, error } = await user.db
    .from("trends")
    .insert({
      project_id: projectId,
      sport_id: sport!.id,
      event_id: event.id,
      title,
      description: "Bologna won away at Inter.",
      trend_score: 74,
      competition_level: "low",
      publisher_count: 4,
      source_count: 3,
      signals: ["upset", "rivalry"],
      last_seen_at: hoursAgo(1),
      is_sweet_spot: true,
      status: "rising",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const sourceIds: string[] = [];
  for (const [i, name] of ["Agency", "Daily", "Club site"].entries()) {
    const { data: s, error: sError } = await user.db
      .from("sources")
      .insert({ project_id: projectId, name, title: `${name}: Bologna win at San Siro`, url: `https://example.test/${projectId}/${randomUUID()}`, published_at: hoursAgo(3 - i) })
      .select("id")
      .single();
    if (sError) throw new Error(sError.message);
    sourceIds.push(s.id);
  }
  const { error: linkError } = await user.db
    .from("trend_sources")
    .insert(sourceIds.map((source_id) => ({ project_id: projectId, trend_id: trend.id, source_id })));
  if (linkError) throw new Error(linkError.message);
  return { trendId: trend.id, eventId: event.id, sportId: sport!.id, sourceIds };
}

let alice: { id: string; db: Db };
let bob: { id: string; db: Db };
let projectA = "";
let projectB = "";
let seedA: Awaited<ReturnType<typeof seedTrend>>;
let seedB: Awaited<ReturnType<typeof seedTrend>>;

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  projectA = await newProject(alice, "Opp A");
  projectB = await newProject(bob, "Opp B");
  seedA = await seedTrend(alice, projectA);
  seedB = await seedTrend(bob, projectB, "Foreign trend");
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

const components = (explanation: unknown) => (explanation as { components: ComponentExplanation[] }).components;

describe("create from trend", () => {
  it("creates a linked, explained, heuristic-scored opportunity and seeds research with the trend's sources", async () => {
    const res = await createFromTrend(alice.db, { projectId: projectA, trendId: seedA.trendId, userId: alice.id });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ existing: false, researchItems: 3 });

    const { data: o } = await alice.db.from("opportunities").select("*").eq("id", res.data!.id).single();
    expect(o).toMatchObject({
      project_id: projectA,
      trend_id: seedA.trendId,
      event_id: seedA.eventId,
      sport_id: seedA.sportId,
      title: "Bologna stun Inter 3-0 at San Siro",
      competition: "Serie A",
      signals: ["upset", "rivalry"],
      competition_level: "low",
      is_sweet_spot: true,
      status: "new",
      created_by: alice.id,
      trend_score: 74,
      competition_gap_score: 80,
      rights_score: 85,
      audience_score: 95, // football 90 + rivalry 5
      originality_score: null, // no reliable heuristic without an angle
    });
    expect(o!.why_now).toMatch(/Inter vs Bologna finished 2h ago/);
    expect(o!.opportunity_score).toBeGreaterThan(0);
    expect(Number(o!.score_coverage)).toBe(85);
    const comps = components(o!.score_explanation);
    expect(comps).toHaveLength(9);
    expect(comps.filter((c) => c.value !== null).every((c) => c.origin === "heuristic" && c.reason.length > 10)).toBe(true);
    expect((o!.score_explanation as { notes: Record<string, string> }).notes.originality).toMatch(/No angle yet/);

    const { data: items } = await alice.db.from("research_items").select("item_type, source_id, url, created_by").eq("opportunity_id", o!.id);
    expect(items).toHaveLength(3);
    expect(items!.every((i) => i.item_type === "article" && i.created_by === alice.id && seedA.sourceIds.includes(i.source_id!))).toBe(true);
  });

  it("returns the open opportunity instead of a duplicate", async () => {
    const res = await createFromTrend(alice.db, { projectId: projectA, trendId: seedA.trendId, userId: alice.id });
    expect(res.data?.existing).toBe(true);
    const { count } = await alice.db.from("opportunities").select("id", { count: "exact", head: true }).eq("trend_id", seedA.trendId);
    expect(count).toBe(1);
  });

  it("rejects a trend of another project", async () => {
    // Alice, active project A, Bob's trend id
    const res = await createFromTrend(alice.db, { projectId: projectA, trendId: seedB.trendId, userId: alice.id });
    expect(res.error?.message).toMatch(/NOT_FOUND/);
    // Alice pretending project B is active: RLS hides it as well
    const res2 = await createFromTrend(alice.db, { projectId: projectB, trendId: seedB.trendId, userId: alice.id });
    expect(res2.error?.message).toMatch(/NOT_FOUND/);
    const { count } = await admin.from("opportunities").select("id", { count: "exact", head: true }).eq("trend_id", seedB.trendId);
    expect(count).toBe(0);
  });
});

describe("scoring edits", () => {
  it("manual overrides survive heuristic rescoring; reset returns to the heuristic", async () => {
    const m = await createManual(alice.db, {
      projectId: projectA,
      userId: alice.id,
      input: { title: "Why Bologna press so high", description: null, why_now: null, angle: null, hook: null, competition: null, sportId: seedA.sportId },
    });
    expect(m.error).toBeNull();
    const id = m.data!.id;

    const set = await setComponent(alice.db, { projectId: projectA, id, component: "rights_safety", value: 40, reason: "Plan relies on broadcast clips" });
    expect(set.error).toBeNull();
    await rescoreHeuristics(alice.db, { projectId: projectA, id });
    let { data: o } = await alice.db.from("opportunities").select("rights_score, score_explanation").eq("id", id).single();
    expect(o!.rights_score).toBe(40);
    expect(components(o!.score_explanation).find((c) => c.key === "rights_safety")).toMatchObject({ origin: "manual", reason: "Plan relies on broadcast clips" });

    await resetComponent(alice.db, { projectId: projectA, id, component: "rights_safety" });
    ({ data: o } = await alice.db.from("opportunities").select("rights_score, score_explanation").eq("id", id).single());
    expect(o!.rights_score).toBe(85);
    expect(components(o!.score_explanation).find((c) => c.key === "rights_safety")?.origin).toBe("heuristic");
  });

  it("editing fields recomputes heuristics (a distinct angle unlocks originality)", async () => {
    const list = await listOpportunities(alice.db, projectA, { search: "San Siro" });
    const id = list.data![0].id;
    const res = await updateFields(alice.db, {
      projectId: projectA,
      id,
      fields: {
        title: "Bologna stun Inter 3-0 at San Siro",
        description: null,
        why_now: "Finished tonight",
        angle: "How a pressing trap rehearsed all week exposed the champions' build-up",
        hook: null,
        competition: "Serie A",
      },
    });
    expect(res.error).toBeNull();
    const { data: o } = await alice.db.from("opportunities").select("originality_score, why_now, score_coverage").eq("id", id).single();
    expect(o).toMatchObject({ originality_score: 65, why_now: "Finished tonight" });
    expect(Number(o!.score_coverage)).toBe(100);
  });

  it("another project's user can neither read nor edit", async () => {
    const list = await listOpportunities(alice.db, projectA, {});
    const id = list.data![0].id;
    const asBob = await setComponent(bob.db, { projectId: projectA, id, component: "trend", value: 1, reason: "sabotage" });
    expect(asBob.error?.message).toMatch(/NOT_FOUND/);
    expect((await listOpportunities(bob.db, projectA, {})).data).toEqual([]);
    expect((await getOpportunityDetail(bob.db, projectA, id)).error?.message).toMatch(/NOT_FOUND/);
  });

  it("filters the list by status, score, signal, sweet spot and search", async () => {
    const all = (await listOpportunities(alice.db, projectA, {})).data!;
    expect(all.length).toBe(2);
    const scores = all.map((o) => o.opportunity_score ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await listOpportunities(alice.db, projectA, { signal: "upset" })).data!.map((o) => o.title)).toEqual(["Bologna stun Inter 3-0 at San Siro"]);
    expect((await listOpportunities(alice.db, projectA, { sweetSpot: true })).data).toHaveLength(1);
    expect((await listOpportunities(alice.db, projectA, { status: "approved" })).data).toHaveLength(0);
    expect((await listOpportunities(alice.db, projectA, { minScore: 101 })).data).toHaveLength(0);
    expect((await listOpportunities(alice.db, projectA, { search: "100%_" })).data).toHaveLength(0);
    expect(all[0].sport?.name).toBe("Football (Soccer)");
  });
});

describe("approval checkpoint and production", () => {
  async function fresh() {
    const res = await createManual(alice.db, {
      projectId: projectA,
      userId: alice.id,
      input: { title: `Prod ${randomUUID().slice(0, 6)}`, description: "A one-line logline.", why_now: null, angle: "Data angle", hook: "Nobody saw it coming", competition: null, sportId: null },
    });
    return res.data!.id;
  }

  it("refuses to start production before approval", async () => {
    const id = await fresh();
    const res = await startProduction(alice.db, { projectId: projectA, id, userId: alice.id });
    expect(res.error?.code).toBe("NOT_APPROVED");
    const { count } = await alice.db.from("stories").select("id", { count: "exact", head: true }).eq("opportunity_id", id);
    expect(count).toBe(0);
  });

  it("records the human decision through record_approval (reject, then approve)", async () => {
    const id = await fresh();
    const rejected = await decideOpportunity(alice.db, { projectId: projectA, id, decision: "rejected", notes: "Too thin" });
    expect(rejected.error).toBeNull();
    expect((await alice.db.from("opportunities").select("status").eq("id", id).single()).data!.status).toBe("rejected");
    const approved = await decideOpportunity(alice.db, { projectId: projectA, id, decision: "approved", notes: "New data makes it work" });
    expect(approved.error).toBeNull();

    const detail = await getOpportunityDetail(alice.db, projectA, id);
    expect(detail.data!.opportunity.status).toBe("approved");
    expect(detail.data!.latestDecision).toMatchObject({ decision: "approved", notes: "New data makes it work" });
    expect(detail.data!.latestDecision!.decidedBy).toMatch(/@example\.test$/);

    const { data: approvals } = await alice.db.from("approvals").select("decision, decided_by, checkpoint").eq("entity_id", id).order("created_at");
    expect(approvals).toEqual([
      { decision: "rejected", decided_by: alice.id, checkpoint: "opportunity" },
      { decision: "approved", decided_by: alice.id, checkpoint: "opportunity" },
    ]);
  });

  it("automated callers (service role) cannot approve", async () => {
    const id = await fresh();
    const res = await decideOpportunity(admin, { projectId: projectA, id, decision: "approved", notes: null });
    expect(res.error?.message).toMatch(/APPROVAL_REQUIRES_HUMAN/);
  });

  it("an approved opportunity becomes a story + content item in RESEARCH; decisions lock", async () => {
    const id = await fresh();
    await decideOpportunity(alice.db, { projectId: projectA, id, decision: "approved", notes: null });
    const res = await startProduction(alice.db, { projectId: projectA, id, userId: alice.id });
    expect(res.error).toBeNull();
    expect(res.data!.existing).toBe(false);

    const { data: item } = await alice.db.from("content_items").select("*").eq("id", res.data!.contentItemId).single();
    expect(item).toMatchObject({ project_id: projectA, opportunity_id: id, story_id: res.data!.storyId, stage: "research", format: "short", created_by: alice.id });
    const { data: story } = await alice.db.from("stories").select("*").eq("id", res.data!.storyId!).single();
    expect(story).toMatchObject({ opportunity_id: id, title: item!.title, logline: "A one-line logline.", angle: "Data angle", status: "draft" });
    expect((await alice.db.from("opportunities").select("status").eq("id", id).single()).data!.status).toBe("production");

    // a second click lands on the same content item
    const again = await startProduction(alice.db, { projectId: projectA, id, userId: alice.id });
    expect(again.data).toMatchObject({ contentItemId: res.data!.contentItemId, existing: true });
    expect((await alice.db.from("stories").select("id", { count: "exact", head: true }).eq("opportunity_id", id)).count).toBe(1);

    const locked = await decideOpportunity(alice.db, { projectId: projectA, id, decision: "rejected", notes: null });
    expect(locked.error?.code).toBe("DECISION_LOCKED");
  });

  it("another project cannot approve or produce it", async () => {
    const id = await fresh();
    expect((await decideOpportunity(bob.db, { projectId: projectA, id, decision: "approved", notes: null })).error?.message).toMatch(/NOT_FOUND/);
    expect((await startProduction(bob.db, { projectId: projectB, id, userId: bob.id })).error?.message).toMatch(/NOT_FOUND/);
  });
});

/* ------------------------------------------------------------------------- */
/* worker: opportunity.ai_score with a fake model (no real API calls)        */
/* ------------------------------------------------------------------------- */

function fakeRouter(output: unknown) {
  const provider: AIProvider = {
    id: "anthropic",
    isConfigured: () => true,
    complete: async (): Promise<AICallResult> => ({
      text: JSON.stringify(output),
      usage: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: "claude-haiku-5-5",
      latencyMs: 3,
      stopReason: "end_turn",
    }),
  };
  return createAIRouter({
    providers: { anthropic: provider },
    resolveConfig: () => ({ task: "scoring", primary: { provider: "anthropic", model: "claude-haiku-5-5" }, fallbacks: [], effort: "low", maxOutputTokens: 4000, source: "default" }),
  });
}

async function runningJob(projectId: string, payload: unknown) {
  const { rows } = await pool.query(
    `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at)
     values ($1, 'opportunity.ai_score', $2, 'running', 1, now(), 'test', now()) returning *`,
    [projectId, JSON.stringify(payload)],
  );
  return rows[0];
}

describe("worker: opportunity.ai_score", () => {
  it("applies AI values (origin 'ai'), never overrides manual ones, logs the run and the activity", async () => {
    const list = await listOpportunities(alice.db, projectA, { search: "San Siro" });
    const id = list.data![0].id;
    await setComponent(alice.db, { projectId: projectA, id, component: "audience", value: 33, reason: "Our audience is niche" });

    const payload = { opportunityIds: [id] };
    const job = await runningJob(projectA, payload);
    const base = createJobContext(admin, job);
    const ctx: JobContext = {
      ...base,
      ai: async () =>
        fakeRouter({
          components: [
            { component: "curiosity", value: 88, reason: "An away upset invites questions." },
            { component: "audience", value: 95, reason: "Big clubs." },
            { component: "monetization", value: 64, reason: "Brand-safe sports result." },
          ],
        }),
    };
    const result = (await aiScoreHandler.run(ctx, payload)) as {
      scored: number;
      totalCostUsd: number;
      results: { applied: string[]; rejected: { component: string; code: string }[] }[];
    };
    expect(result.scored).toBe(1);
    expect(result.results[0].applied).toEqual(["curiosity", "monetization"]);
    // the manual component was not even requested; the model's value for it is rejected
    expect(result.results[0].rejected).toEqual([expect.objectContaining({ component: "audience", code: "manual" })]);
    expect(result.totalCostUsd).toBeCloseTo((800 * 0.1 + 200 * 0.5) / 1_000_000, 8);

    const { data: o } = await alice.db.from("opportunities").select("curiosity_score, audience_score, monetization_score, score_explanation, metadata").eq("id", id).single();
    expect(o).toMatchObject({ curiosity_score: 88, audience_score: 33, monetization_score: 64 });
    const comps = components(o!.score_explanation);
    expect(comps.find((c) => c.key === "curiosity")?.origin).toBe("ai");
    expect(comps.find((c) => c.key === "audience")).toMatchObject({ origin: "manual", reason: "Our audience is niche" });
    expect((o!.metadata as { ai_scoring: { model: string } }).ai_scoring.model).toBe("claude-haiku-5-5");

    const runs = await pool.query("select agent, status, model, cost_usd from public.agent_runs where project_id = $1", [projectA]);
    expect(runs.rows).toEqual([{ agent: "trend_hunter", status: "completed", model: "claude-haiku-5-5", cost_usd: "0.0002" }]);
    const logs = await pool.query("select action, status from public.activity_logs where project_id = $1 and entity_id = $2", [projectA, id]);
    expect(logs.rows).toContainEqual({ action: "opportunity.ai_scored", status: "success" });

    // heuristic rescoring keeps the AI value
    await rescoreHeuristics(alice.db, { projectId: projectA, id });
    expect((await alice.db.from("opportunities").select("curiosity_score").eq("id", id).single()).data!.curiosity_score).toBe(88);
  });

  it("refuses an opportunity of another project (JobInputError, no AI call)", async () => {
    const foreign = await createFromTrend(bob.db, { projectId: projectB, trendId: seedB.trendId, userId: bob.id });
    const payload = { opportunityIds: [foreign.data!.id] };
    const job = await runningJob(projectA, payload);
    let called = false;
    const ctx: JobContext = {
      ...createJobContext(admin, job),
      ai: async () => {
        called = true;
        return fakeRouter({ components: [] });
      },
    };
    await expect(aiScoreHandler.run(ctx, payload)).rejects.toBeInstanceOf(JobInputError);
    expect(called).toBe(false);
  });
});
