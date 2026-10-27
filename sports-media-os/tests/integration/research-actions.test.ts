import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Research server actions end to end: FormData → zod → service (signed-in
 * client, RLS) → user-safe result. Only the Next.js request APIs are mocked
 * (session, active-project cookie, revalidation); the database is real.
 */

type Db = SupabaseClient<Database>;
const session = vi.hoisted(() => ({ userId: "", projectId: "", db: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async () => ({ id: session.userId, email: "user@example.test", displayName: null, role: "member" }),
}));
vi.mock("@/lib/projects/service", () => ({
  getActiveProject: async () => (session.projectId ? { id: session.projectId, name: "P", slug: "p", timezone: "UTC", status: "active", color: null } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.db }));

const actions = await import("@/lib/research/actions");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db; projectId: string; opportunityId: string };

async function setupUser(): Promise<User> {
  const email = `research-actions-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  const { data: p } = await db.from("projects").insert({ owner_id: data.user.id, name: "Actions", slug: `ra-${randomUUID().slice(0, 8)}` }).select("id").single();
  created.projects.push(p!.id);
  const { data: o } = await db.from("opportunities").insert({ project_id: p!.id, title: "Derby day upset" }).select("id").single();
  return { id: data.user.id, db, projectId: p!.id, opportunityId: o!.id };
}

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const signIn = (u: User) => Object.assign(session, { userId: u.id, projectId: u.projectId, db: u.db });

let alice: User;
let bob: User;

beforeAll(async () => {
  alice = await setupUser();
  bob = await setupUser();
});
beforeEach(() => signIn(alice));

afterAll(async () => {
  await pool.query("delete from public.jobs where project_id = any($1)", [created.projects]);
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

async function claimIdOf(text: string) {
  const { data } = await alice.db.from("facts").select("id").eq("claim", text).eq("project_id", alice.projectId).single();
  return data!.id;
}

describe("research actions", () => {
  it("validates forms and returns field errors without touching the database", async () => {
    const res = await actions.createClaimAction(null, form({ opportunityId: alice.opportunityId, claim: "   " }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { claim: [expect.stringMatching(/Write the claim/)] } });

    const quote = await actions.createItemAction(null, form({ opportunityId: alice.opportunityId, type: "quote", speaker: "Coach", content: "We believe." }));
    expect(quote).toMatchObject({ ok: false, fieldErrors: { sourceId: [expect.stringMatching(/Attribute the quote/)] } });

    expect(await actions.createItemAction(null, form({ opportunityId: "nope", type: "note", content: "x" }))).toMatchObject({ ok: false, error: "Invalid opportunity." });
    session.projectId = "";
    expect(await actions.createClaimAction(null, form({ opportunityId: alice.opportunityId, claim: "x" }))).toMatchObject({ ok: false, error: /select a project/ });
  });

  it("claim flow: add → link a pasted link as Mentions → confirm refused → set Supports → confirm", async () => {
    const add = await actions.createClaimAction(null, form({ opportunityId: alice.opportunityId, claim: "Record crowd of 75,000", isCritical: "on" }));
    expect(add).toMatchObject({ ok: true, message: expect.stringMatching(/Uncertain/) });
    const factId = await claimIdOf("Record crowd of 75,000");

    const link = await actions.linkClaimSourceAction(
      null,
      form({ factId, opportunityId: alice.opportunityId, sourceId: "", newUrl: "https://www.league.example/report?utm_source=x", relation: "mentions", excerpt: "75,000 fans", locator: "" }),
    );
    expect(link).toMatchObject({ ok: true, message: "Source linked." });
    const { data: src } = await alice.db.from("sources").select("id, url").eq("project_id", alice.projectId).single();
    expect(src!.url).toBe("https://www.league.example/report");

    const refused = await actions.setClaimStatusAction(null, form({ factId, status: "confirmed", confidence: "0.9", notes: "" }));
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/supporting source/) });

    expect(await actions.setLinkRelationAction(null, form({ factId, sourceId: src!.id, relation: "supports" }))).toMatchObject({ ok: true });
    const confirmed = await actions.setClaimStatusAction(null, form({ factId, status: "confirmed", confidence: "0.9", notes: "League report" }));
    expect(confirmed).toMatchObject({ ok: true });
    expect((await alice.db.from("facts").select("status, checked_by").eq("id", factId).single()).data).toEqual({ status: "confirmed", checked_by: alice.id });

    const unlinked = await actions.unlinkClaimSourceAction(null, form({ factId, sourceId: src!.id }));
    expect(unlinked).toMatchObject({ ok: true, message: expect.stringMatching(/back to Uncertain/) });
  });

  it("answers a question and reports refused deletes as a permission problem", async () => {
    expect(await actions.createItemAction(null, form({ opportunityId: alice.opportunityId, type: "question", content: "Who refereed?" }))).toMatchObject({ ok: true });
    const { data: q } = await alice.db.from("research_items").select("id").eq("opportunity_id", alice.opportunityId).eq("item_type", "question").single();
    expect(await actions.answerQuestionAction(null, form({ itemId: q!.id, answered: "true", answer: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { answer: [expect.any(String)] },
    });
    expect(await actions.answerQuestionAction(null, form({ itemId: q!.id, answered: "true", answer: "Orsato" }))).toMatchObject({ ok: true, message: "Marked answered." });

    // an editor (not admin) cannot delete research
    await pool.query("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'editor')", [alice.projectId, bob.id]);
    signIn({ ...bob, projectId: alice.projectId });
    expect(await actions.deleteItemAction(null, form({ itemId: q!.id }))).toMatchObject({ ok: false, error: expect.stringMatching(/project admin/) });
    await pool.query("delete from public.project_members where project_id = $1 and user_id = $2", [alice.projectId, bob.id]);
  });

  it("never touches another project's workspace", async () => {
    signIn(bob);
    expect(await actions.createClaimAction(null, form({ opportunityId: alice.opportunityId, claim: "Sneaky" }))).toMatchObject({ ok: false, error: /Not found/ });
    const factId = await claimIdOf("Record crowd of 75,000");
    expect(await actions.setClaimStatusAction(null, form({ factId, status: "false", confidence: "", notes: "" }))).toMatchObject({ ok: false, error: /Not found/ });
    expect(await actions.requestFactCheckAction(factId)).toMatchObject({ ok: false, error: /Not found/ });
    expect(await actions.requestResearchSuggestionsAction(alice.opportunityId)).toMatchObject({ ok: false, error: /Not found/ });
  });

  it("AI actions only enqueue jobs (deduplicated) and refuse to assess a claim without sources", async () => {
    const first = await actions.requestResearchSuggestionsAction(alice.opportunityId);
    expect(first).toMatchObject({ ok: true, data: { deduplicated: false } });
    const again = await actions.requestResearchSuggestionsAction(alice.opportunityId);
    expect(again).toMatchObject({ ok: true, data: { jobId: first.ok ? first.data.jobId : "", deduplicated: true } });
    const { rows } = await pool.query("select type, status, payload, created_by from public.jobs where project_id = $1", [alice.projectId]);
    expect(rows).toEqual([{ type: "research.suggest", status: "pending", payload: { opportunityId: alice.opportunityId }, created_by: alice.id }]);

    await actions.createClaimAction(null, form({ opportunityId: alice.opportunityId, claim: "No evidence yet", isCritical: "on" }));
    const lonely = await claimIdOf("No evidence yet");
    expect(await actions.requestFactCheckAction(lonely)).toMatchObject({ ok: false, error: expect.stringMatching(/Link at least one source/) });
    expect(await actions.applyClaimSuggestionAction(null, form({ factId: lonely }))).toMatchObject({ ok: false, error: /no AI suggestion/ });
  });

  it("applies a stored AI suggestion only while it matches the claim and its sources", async () => {
    const factId = await claimIdOf("Record crowd of 75,000");
    const { data: src } = await alice.db.from("sources").select("id").eq("project_id", alice.projectId).single();
    await actions.linkClaimSourceAction(null, form({ factId, opportunityId: alice.opportunityId, sourceId: src!.id, relation: "supports", excerpt: "", locator: "" }));
    const suggestion = {
      version: 1,
      suggestedStatus: "probable",
      confidence: 0.7,
      reasoning: "The report mentions 75,000.",
      sources: [{ sourceId: src!.id, relation: "supports", note: null }],
      adjustment: null,
      droppedSourceIds: 0,
      claim: "Record crowd of 75,000",
      assessedSourceIds: [src!.id],
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      promptVersion: "factcheck-assess-v1",
      at: new Date().toISOString(),
      jobId: null,
      costUsd: 0.001,
    };
    await admin.from("facts").update({ ai_suggestion: suggestion }).eq("id", factId);

    expect(await actions.applyClaimSuggestionAction(null, form({ factId }))).toMatchObject({ ok: true, message: "Suggestion applied." });
    expect((await alice.db.from("facts").select("status, confidence, checked_by").eq("id", factId).single()).data).toEqual({
      status: "probable",
      confidence: 0.7,
      checked_by: alice.id,
    });

    await actions.updateClaimAction(null, form({ factId, claim: "Record crowd of 80,000", isCritical: "on" }));
    expect(await actions.applyClaimSuggestionAction(null, form({ factId }))).toMatchObject({ ok: false, error: expect.stringMatching(/edited after this assessment/) });
  });
});
