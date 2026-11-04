import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Content server actions end to end: input → zod → service (signed-in client,
 * RLS + project filter) → user-safe ActionResult. Only the Next.js request APIs
 * are mocked (session, active project, revalidation); the database is real.
 */

type Db = SupabaseClient<Database>;
const session = vi.hoisted(() => ({ userId: "", projectId: "", db: null as unknown }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/dal", () => ({
  requireUser: async () => ({ id: session.userId, email: "user@example.test", displayName: null, role: "member" }),
}));
vi.mock("@/lib/projects/service", () => ({
  getActiveProject: async () => (session.projectId ? { id: session.projectId, name: "P", slug: "p", timezone: "UTC", status: "active", color: null } : null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.db }));

const actions = await import("@/lib/content/actions");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db; projectId: string };

async function setupUser(): Promise<User> {
  const email = `content-actions-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.users.push(data.user.id);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);
  const { data: p, error: pe } = await db
    .from("projects")
    .insert({ owner_id: data.user.id, name: "Content actions", slug: `ca-${randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (pe || !p) throw new Error(pe?.message ?? "project insert failed");
  created.projects.push(p.id);
  return { id: data.user.id, db, projectId: p.id };
}

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const signIn = (u: User) => Object.assign(session, { userId: u.id, projectId: u.projectId, db: u.db });

async function stageOf(id: string) {
  const { rows } = await pool.query<{ stage: string; title: string; story_id: string | null }>(
    "select stage, title, story_id from public.content_items where id = $1",
    [id],
  );
  return rows[0];
}

async function newIdea(title: string) {
  const res = await actions.createContentItem(null, form({ title, format: "short", description: "" }));
  if (!res.ok) throw new Error(res.error);
  return res.data.id;
}

let alice: User;
let bob: User;

beforeAll(async () => {
  alice = await setupUser();
  bob = await setupUser();
});
beforeEach(() => {
  signIn(alice);
  revalidatePath.mockClear();
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe("createContentItem", () => {
  it("returns field errors and writes nothing for invalid input", async () => {
    const res = await actions.createContentItem(null, form({ title: "   ", format: "reel", description: "" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.title).toBeTruthy();
    expect(res.fieldErrors?.format).toBeTruthy();
    const { rows } = await pool.query("select count(*)::int as n from public.content_items where project_id = $1", [alice.projectId]);
    expect(rows[0].n).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("adds an idea to IDEA and refreshes the board", async () => {
    const res = await actions.createContentItem(null, form({ title: "  Why Bologna press high  ", format: "long", description: "Explainer" }));
    expect(res).toMatchObject({ ok: true, message: "Idea added to IDEA." });
    if (!res.ok) return;
    expect(await stageOf(res.data.id)).toMatchObject({ stage: "idea", title: "Why Bologna press high" });
    expect(revalidatePath).toHaveBeenCalledWith("/content");
  });

  it("asks for a project when none is active", async () => {
    session.projectId = "";
    expect(await actions.createContentItem(null, form({ title: "x", format: "short" }))).toEqual({
      ok: false,
      error: "Create or select a project first.",
      fieldErrors: undefined,
    });
  });
});

describe("moveContentItem", () => {
  it("validates the move", async () => {
    const id = await newIdea("Validation");
    expect(await actions.moveContentItem({ id, stage: "archived" })).toMatchObject({ ok: false, error: "Unknown stage" });
    expect(await actions.moveContentItem({ id: "nope", stage: "research" })).toMatchObject({ ok: false, error: "Invalid content item" });
    expect((await stageOf(id)).stage).toBe("idea");
  });

  it("moves, says where, and is a no-op on the current stage", async () => {
    const id = await newIdea("Mover");
    revalidatePath.mockClear();
    expect(await actions.moveContentItem({ id, stage: "research" })).toMatchObject({ ok: true, message: "Moved to Research." });
    expect(revalidatePath).toHaveBeenCalledWith(`/content/${id}`);

    revalidatePath.mockClear();
    expect(await actions.moveContentItem({ id, stage: "research" })).toMatchObject({ ok: true, message: "Already in Research.", data: { changed: false } });
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await actions.moveContentItem({ id, stage: "research", index: 0 })).toMatchObject({ ok: true, message: "Order saved." });
  });

  it("returns the DB refusal as a clear message (optimistic UI rolls back on it)", async () => {
    const id = await newIdea("Gated");
    await actions.moveContentItem({ id, stage: "review" });
    expect(await actions.moveContentItem({ id, stage: "production" })).toEqual({
      ok: false,
      error: "Create the story and approve its current script before moving to production.",
      fieldErrors: undefined,
    });

    const story = await actions.createStoryForItemAction(id);
    if (!story.ok) throw new Error(story.error);
    await alice.db.from("scripts").insert({ project_id: alice.projectId, story_id: story.data.storyId, version: 1, hook: "Hook", is_current: true });
    expect(await actions.moveContentItem({ id, stage: "production" })).toMatchObject({
      ok: false,
      error: "Approve the current script before moving to production.",
    });
    expect((await stageOf(id)).stage).toBe("review");
  });

  it("never moves another project's item", async () => {
    const id = await newIdea("Alice only");
    signIn(bob);
    expect(await actions.moveContentItem({ id, stage: "research" })).toMatchObject({ ok: false, error: "Not found or you don't have access." });
    expect((await stageOf(id)).stage).toBe("idea");
  });
});

describe("updateContentItem", () => {
  it("validates and saves the fields", async () => {
    const id = await newIdea("Before");
    expect(await actions.updateContentItem(null, form({ id: "bad", title: "x", format: "short" }))).toMatchObject({ ok: false, error: "Invalid content item." });
    const invalid = await actions.updateContentItem(null, form({ id, title: "", format: "short" }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.fieldErrors?.title).toBeTruthy();

    expect(await actions.updateContentItem(null, form({ id, title: "After", format: "post", description: "Now a post" }))).toMatchObject({
      ok: true,
      message: "Saved.",
    });
    expect((await stageOf(id)).title).toBe("After");

    signIn(bob);
    expect(await actions.updateContentItem(null, form({ id, title: "Hijacked", format: "post" }))).toMatchObject({ ok: false });
    expect((await stageOf(id)).title).toBe("After");
  });
});

describe("story actions", () => {
  it("creates the story once, then approves it with notes (STORY ≠ FOOTAGE)", async () => {
    const id = await newIdea("Story item");
    const first = await actions.createStoryForItemAction(id);
    expect(first).toMatchObject({ ok: true, message: "Story created and linked." });
    if (!first.ok) return;
    expect((await stageOf(id)).story_id).toBe(first.data.storyId);
    expect(await actions.createStoryForItemAction(id)).toMatchObject({ ok: true, message: "This item already has a story.", data: { storyId: first.data.storyId } });

    expect(await actions.decideStoryAction(first.data.storyId, "maybe")).toMatchObject({ ok: false, error: "Check the decision." });
    expect(await actions.decideStoryAction(first.data.storyId, "approved", "Graphics + voiceover, no footage needed")).toMatchObject({
      ok: true,
      message: "Story approved.",
    });
    const { rows } = await pool.query("select s.status, a.notes, a.decided_by from public.stories s join public.approvals a on a.entity_id = s.id where s.id = $1", [
      first.data.storyId,
    ]);
    expect(rows).toEqual([{ status: "approved", notes: "Graphics + voiceover, no footage needed", decided_by: alice.id }]);

    signIn(bob);
    expect(await actions.decideStoryAction(first.data.storyId, "rejected")).toMatchObject({ ok: false, error: "Not found or you don't have access." });
    expect(await actions.createStoryForItemAction(id)).toMatchObject({ ok: false, error: "Not found or you don't have access." });
  });
});
