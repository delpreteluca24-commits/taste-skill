import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider, AITask } from "@/lib/ai/types";
import { parseGuardError } from "@/lib/db/errors";
import { readStoredSuggestion } from "@/lib/factcheck/sanitize";
import { loadWorkspace, setClaimStatus, setLinkRelation } from "@/lib/research/service";
import type { Database } from "@/types/database";
import { createJobContext, JobInputError, type JobContext } from "@/workers/context";
import { handler as factcheckHandler } from "@/workers/handlers/factcheck-assist";
import { handler as researchHandler } from "@/workers/handlers/research-suggest";

import { pool } from "./db";

/**
 * The research AI jobs run in the worker with the SERVICE ROLE (no RLS):
 * payload ids must belong to the job's project, the model only sees the
 * workspace's own sources, and nothing it returns can confirm a claim.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db };

async function signedInUser(): Promise<User> {
  const email = `research-worker-${randomUUID()}@example.test`;
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

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(error?.message ?? "no data");
  return data as NonNullable<T>;
}

async function seed(user: User, name: string) {
  const project = await must(
    user.db.from("projects").insert({ owner_id: user.id, name, slug: `rw-${randomUUID().slice(0, 8)}` }).select("id").single(),
  );
  created.projects.push(project.id);
  const opp = await must(
    user.db
      .from("opportunities")
      .insert({ project_id: project.id, title: "Bologna stun Inter 3-0 at San Siro", why_now: "Finished two hours ago", angle: "The pressing trap" })
      .select("id")
      .single(),
  );
  const sources: string[] = [];
  for (const [publisher, summary] of [
    ["Agency", "Bologna won 3-0 at San Siro. Orsolini scored twice."],
    ["Daily", "Inter's first home defeat of the season."],
  ]) {
    const s = await must(
      user.db
        .from("sources")
        .insert({ project_id: project.id, name: publisher, title: `${publisher} report`, summary, url: `https://example.test/${randomUUID()}` })
        .select("id")
        .single(),
    );
    sources.push(s.id);
  }
  await must(
    user.db
      .from("research_items")
      .insert(sources.map((source_id, i) => ({ project_id: project.id, opportunity_id: opp.id, source_id, item_type: "article" as const, title: `report ${i}`, position: i })))
      .select("id"),
  );
  return { projectId: project.id, opportunityId: opp.id, sources };
}

let alice: User;
let bob: User;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  alice = await signedInUser();
  bob = await signedInUser();
  a = await seed(alice, "Research worker A");
  b = await seed(bob, "Research worker B");
});

afterAll(async () => {
  await pool.query("delete from public.jobs where project_id = any($1)", [created.projects]);
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

/** a job already claimed by a worker (status running) */
async function runningJob(projectId: string, type: string, payload: unknown, createdBy: string) {
  const { rows } = await pool.query(
    `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at, created_by)
     values ($1, $2, $3, 'running', 1, now(), 'test', now(), $4) returning *`,
    [projectId, type, JSON.stringify(payload), createdBy],
  );
  return rows[0];
}

/** fake provider behind the real router: records what the model was sent */
function fakeAI(task: AITask, output: unknown) {
  const requests: { system: string; messages: { content: string }[] }[] = [];
  const provider: AIProvider = {
    id: "anthropic",
    isConfigured: () => true,
    complete: async (_model, request): Promise<AICallResult> => {
      requests.push(request as never);
      return {
        text: JSON.stringify(output),
        usage: { inputTokens: 1500, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
        servedModel: "claude-sonnet-5-5",
        latencyMs: 5,
        stopReason: "end_turn",
      };
    },
  };
  const router = createAIRouter({
    providers: { anthropic: provider },
    resolveConfig: () => ({ task, primary: { provider: "anthropic", model: "claude-sonnet-5-5" }, fallbacks: [], effort: "medium", maxOutputTokens: 4000, source: "default" }),
  });
  return { router, requests };
}

function contextFor(job: Parameters<typeof createJobContext>[1], ai: ReturnType<typeof fakeAI>): JobContext {
  return { ...createJobContext(admin, job), ai: async () => ai.router };
}

const promptData = (content: string) => JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(content)![1]);

describe("research.suggest (Researcher agent)", () => {
  it("stores sanitised suggestions: claims Uncertain with 'mentions' links only, foreign ids dropped, AI provenance kept", async () => {
    await must(alice.db.from("facts").insert({ project_id: a.projectId, opportunity_id: a.opportunityId, claim: "Orsolini scored twice" }).select("id"));
    const output = {
      questions: ["What did the coach say after the match?"],
      claims: [
        { claim: "Bologna won 3-0 at San Siro", sourceIds: [a.sources[0], b.sources[0]], isCritical: true },
        { claim: "Orsolini scored twice.", sourceIds: [a.sources[0]], isCritical: true }, // already in the workspace
        { claim: "Inter's coach has been sacked", sourceIds: [b.sources[1]], isCritical: true }, // only a foreign source
        { claim: "Was it Inter's first home defeat of the season?", sourceIds: [], isCritical: true },
        { claim: "Bologna are unbeaten in six", sourceIds: [], isCritical: false }, // invented, no source
      ],
      timeline: [{ date: "2026-10-04", event: "Bologna win at San Siro", sourceIds: [a.sources[0]] }],
      context: [{ title: "Form", note: "Inter were unbeaten at home before kick-off", sourceIds: [a.sources[1]] }],
    };
    const ai = fakeAI("research", output);
    const job = await runningJob(a.projectId, "research.suggest", { opportunityId: a.opportunityId }, alice.id);
    const result = (await researchHandler.run(contextFor(job, ai), { opportunityId: a.opportunityId })) as {
      inserted: Record<string, number>;
      dropped: Record<string, number>;
    };

    // the model saw this workspace's sources only
    const data = promptData(ai.requests[0].messages[0].content);
    expect(data.sources.map((s: { id: string }) => s.id).sort()).toEqual([...a.sources].sort());
    expect(JSON.stringify(data)).not.toContain(b.sources[0]);

    expect(result.inserted).toEqual({ claims: 1, questions: 2, timeline: 1, context: 1 });
    expect(result.dropped).toMatchObject({ foreignSourceIds: 2, unsourcedClaims: 2, claimsAsQuestions: 1, duplicates: 1 });

    const { rows: facts } = await pool.query(
      "select id, claim, status, is_critical, checked_by, checked_by_agent from public.facts where opportunity_id = $1 and checked_by_agent = 'researcher'",
      [a.opportunityId],
    );
    expect(facts).toEqual([
      expect.objectContaining({ claim: "Bologna won 3-0 at San Siro", status: "uncertain", is_critical: true, checked_by: null, checked_by_agent: "researcher" }),
    ]);
    const { rows: links } = await pool.query("select source_id, relation, project_id from public.fact_sources where fact_id = $1", [facts[0].id]);
    expect(links).toEqual([{ source_id: a.sources[0], relation: "mentions", project_id: a.projectId }]);

    const { rows: items } = await pool.query(
      "select item_type, content, title, source_id, created_by_agent, metadata from public.research_items where opportunity_id = $1 and created_by_agent is not null order by item_type::text, content",
      [a.opportunityId],
    );
    expect(items.map((i) => i.item_type)).toEqual(["context", "question", "question", "timeline"]);
    expect(items.every((i) => i.created_by_agent === "researcher" && i.metadata.ai === true && i.metadata.model === "claude-sonnet-5-5")).toBe(true);
    expect(items.find((i) => i.item_type === "timeline")).toMatchObject({ source_id: a.sources[0], title: "Bologna win at San Siro" });
    expect(items.filter((i) => i.item_type === "question").map((i) => i.content)).toEqual([
      "Was it Inter's first home defeat of the season?",
      "What did the coach say after the match?",
    ]);

    const runs = await pool.query("select agent, status, model from public.agent_runs where project_id = $1", [a.projectId]);
    expect(runs.rows).toEqual([{ agent: "researcher", status: "completed", model: "claude-sonnet-5-5" }]);

    // running it again adds nothing: every suggestion is already in the workspace
    const again = fakeAI("research", output);
    const job2 = await runningJob(a.projectId, "research.suggest", { opportunityId: a.opportunityId }, alice.id);
    const second = (await researchHandler.run(contextFor(job2, again), { opportunityId: a.opportunityId })) as { inserted: Record<string, number> };
    expect(second.inserted).toEqual({ claims: 0, questions: 0, timeline: 0, context: 0 });

    // the workspace (signed-in user) shows the latest research job and the AI items with their provenance
    const ws = (await loadWorkspace(alice.db, a.projectId, a.opportunityId)).data!;
    expect(ws.researchJob).toMatchObject({ id: job2.id, status: "running" });
    const aiClaim = ws.claims.find((c) => c.claim === "Bologna won 3-0 at San Siro")!;
    expect(aiClaim).toMatchObject({ status: "uncertain", checkedByAgent: "researcher", evidence: { verdict: "mentioned_only", canConfirm: false } });
    expect(ws.items.timeline[0]).toMatchObject({ createdByAgent: "researcher", meta: { ai: true, model: "claude-sonnet-5-5", sourceIds: [a.sources[0]] } });
  });

  it("refuses an opportunity of another project without calling the model", async () => {
    const ai = fakeAI("research", { questions: [], claims: [], timeline: [], context: [] });
    const job = await runningJob(a.projectId, "research.suggest", { opportunityId: b.opportunityId }, alice.id);
    await expect(researchHandler.run(contextFor(job, ai), { opportunityId: b.opportunityId })).rejects.toBeInstanceOf(JobInputError);
    expect(ai.requests).toHaveLength(0);
  });
});

describe("factcheck.assist (Fact Checker agent)", () => {
  it("stores ONLY a suggestion (status untouched); a person applies it through the DB rules", async () => {
    const fact = await must(
      alice.db.from("facts").insert({ project_id: a.projectId, opportunity_id: a.opportunityId, claim: "Bologna won 3-0 at San Siro by three goals" }).select("id").single(),
    );
    await must(
      alice.db
        .from("fact_sources")
        .insert({ project_id: a.projectId, fact_id: fact.id, source_id: a.sources[0], relation: "mentions", excerpt: "Bologna won 3-0 at San Siro." })
        .select("fact_id"),
    );
    const before = await must(admin.from("facts").select("status, confidence, checked_at, checked_by_agent").eq("id", fact.id).single());

    const ai = fakeAI("fact_check", {
      suggestedStatus: "confirmed",
      confidence: 0.93,
      reasoning: 'The agency report reads "Bologna won 3-0 at San Siro".',
      sources: [
        { sourceId: a.sources[0], relation: "supports", note: "states the score" },
        { sourceId: b.sources[0], relation: "supports", note: "not linked to this claim" },
      ],
    });
    const job = await runningJob(a.projectId, "factcheck.assist", { factId: fact.id }, alice.id);
    // while the job is open, the claim shows it (the UI follows it with <JobStatus>)
    const pendingView = (await loadWorkspace(alice.db, a.projectId, a.opportunityId)).data!.claims.find((c) => c.id === fact.id)!;
    expect(pendingView.activeJobId).toBe(job.id);

    const result = await factcheckHandler.run(contextFor(job, ai), { factId: fact.id });
    expect(result).toMatchObject({ suggestedStatus: "confirmed", droppedSourceIds: 1 });

    // the model saw the claim and its linked source only
    const data = promptData(ai.requests[0].messages[0].content);
    expect(data.sources.map((s: { id: string }) => s.id)).toEqual([a.sources[0]]);
    expect(data.sources[0]).toMatchObject({ excerpt: "Bologna won 3-0 at San Siro.", current_relation: "mentions" });

    const after = await must(admin.from("facts").select("status, confidence, checked_at, checked_by_agent, ai_suggestion").eq("id", fact.id).single());
    expect(after).toMatchObject({ status: before.status, confidence: before.confidence, checked_at: before.checked_at, checked_by_agent: before.checked_by_agent });
    const stored = readStoredSuggestion(after.ai_suggestion)!;
    expect(stored).toMatchObject({ suggestedStatus: "confirmed", confidence: 0.93, model: "claude-sonnet-5-5", droppedSourceIds: 1, assessedSourceIds: [a.sources[0]] });
    expect(stored.sources).toEqual([{ sourceId: a.sources[0], relation: "supports", note: "states the score" }]);
    expect(Date.parse(stored.at)).not.toBeNaN();

    // applying 'confirmed' while the link is still 'mentions' is refused by the DB...
    const refused = await setClaimStatus(alice.db, { projectId: a.projectId, factId: fact.id, status: "confirmed", confidence: stored.confidence, notes: null });
    expect(parseGuardError(refused.error as never)?.code).toBe("CLAIM_UNSOURCED");
    // ...until a person accepts the suggested relation
    await setLinkRelation(alice.db, { projectId: a.projectId, factId: fact.id, sourceId: a.sources[0], relation: "supports" });
    expect((await setClaimStatus(alice.db, { projectId: a.projectId, factId: fact.id, status: "confirmed", confidence: stored.confidence, notes: null })).error).toBeNull();
    expect(await must(admin.from("facts").select("status, checked_by").eq("id", fact.id).single())).toEqual({ status: "confirmed", checked_by: alice.id });
  });

  it("refuses a claim of another project, and a claim without linked sources, without calling the model", async () => {
    const foreignFact = await must(bob.db.from("facts").insert({ project_id: b.projectId, opportunity_id: b.opportunityId, claim: "Foreign" }).select("id").single());
    const ai = fakeAI("fact_check", {});
    const job = await runningJob(a.projectId, "factcheck.assist", { factId: foreignFact.id }, alice.id);
    await expect(factcheckHandler.run(contextFor(job, ai), { factId: foreignFact.id })).rejects.toBeInstanceOf(JobInputError);

    const lonely = await must(alice.db.from("facts").insert({ project_id: a.projectId, opportunity_id: a.opportunityId, claim: "No sources yet" }).select("id").single());
    const job2 = await runningJob(a.projectId, "factcheck.assist", { factId: lonely.id }, alice.id);
    await expect(factcheckHandler.run(contextFor(job2, ai), { factId: lonely.id })).rejects.toThrow(/Link at least one source/);
    expect(ai.requests).toHaveLength(0);
  });
});
