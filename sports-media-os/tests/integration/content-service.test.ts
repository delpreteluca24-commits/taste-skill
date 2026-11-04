import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { groupByStage } from "@/lib/content/board";
import { board, createIdea, createStoryForItem, decideStory, detail, move, updateItem } from "@/lib/content/service";
import type { ContentStage } from "@/lib/content/stages";
import { parseGuardError } from "@/lib/db/errors";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * Content Kanban & content item end to end against the real database, through
 * lib/content/service with signed-in users (RLS + project filter). The gates are
 * the database's (SCRIPT_NOT_APPROVED, CONTENT_NOT_READY): the service moves and
 * maps what the DB refuses. Nothing crosses projects; viewers change nothing.
 */

type Db = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const admin: Db = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = { users: [] as string[], projects: [] as string[] };
type User = { id: string; db: Db };

async function signedInUser(): Promise<User> {
  const email = `content-${randomUUID()}@example.test`;
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

async function newProject(user: User, name: string) {
  const project = await must(
    user.db.from("projects").insert({ owner_id: user.id, name, slug: `ct-${randomUUID().slice(0, 8)}` }).select("id").single(),
  );
  created.projects.push(project.id);
  return project.id;
}

/** DB truth, read as superuser (bypasses RLS) */
async function row(id: string) {
  const { rows } = await pool.query<{ stage: ContentStage; position: number; story_id: string | null; title: string; format: string; description: string | null }>(
    "select stage, position, story_id, title, format, description from public.content_items where id = $1",
    [id],
  );
  return rows[0];
}

async function idea(user: User, projectId: string, title: string, description: string | null = null) {
  const res = await createIdea(user.db, { projectId, userId: user.id, input: { title, format: "short", description } });
  expect(res.error).toBeNull();
  return res.data!.id;
}

/** a new current script version for the story (as the editor, like Script Studio) */
async function addScript(user: User, projectId: string, storyId: string, version: number) {
  const script = await must(
    user.db
      .from("scripts")
      .insert({ project_id: projectId, story_id: storyId, version, hook: `Hook v${version}`, full_text: `Script v${version}`, created_by: user.id })
      .select("id")
      .single(),
  );
  await must(user.db.from("scripts").update({ is_current: true }).eq("id", script.id).select("id").single());
  return script.id;
}

const guardCode = (error: unknown) => parseGuardError(error as never)?.code;

let alice: User; // owner of project A
let bob: User; // owner of project B
let carol: User; // viewer of project A
let projectA: string;
let projectB: string;

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([signedInUser(), signedInUser(), signedInUser()]);
  projectA = await newProject(alice, "Content A");
  projectB = await newProject(bob, "Content B");
  await must(admin.from("project_members").insert({ project_id: projectA, user_id: carol.id, role: "viewer" }).select("user_id"));
});

afterAll(async () => {
  if (created.projects.length) await admin.from("projects").delete().in("id", created.projects);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  await pool.end();
});

describe("ideas and the board", () => {
  it("creates ideas in IDEA, newest at the top of the column", async () => {
    const projectId = await newProject(alice, "Ideas");
    const first = await idea(alice, projectId, "Why Bologna press so high", "Tactical explainer");
    const second = await idea(alice, projectId, "Five numbers from the derby");

    expect(await row(first)).toMatchObject({ stage: "idea", title: "Why Bologna press so high", format: "short", description: "Tactical explainer" });
    expect((await row(second)).position).toBeLessThan((await row(first)).position);

    const res = await board(alice.db, projectId);
    expect(res.error).toBeNull();
    const ideaColumn = groupByStage(res.data!.items).find((c) => c.stage === "idea")!;
    expect(ideaColumn.items.map((i) => i.id)).toEqual([second, first]);
    expect(res.data!.truncated).toBe(false);
  });

  it("rejects an invalid title through the DB check (service returns the error)", async () => {
    const res = await createIdea(alice.db, { projectId: projectA, userId: alice.id, input: { title: "x".repeat(301), format: "short", description: null } });
    expect(res.error).not.toBeNull();
  });

  it("loads cards with story/opportunity titles, score, current script + latest decision and blockers for review items", async () => {
    const projectId = await newProject(alice, "Board");
    const opp = await must(
      alice.db.from("opportunities").insert({ project_id: projectId, title: "Inter's home slump", opportunity_score: 82 }).select("id").single(),
    );
    const story = await must(alice.db.from("stories").insert({ project_id: projectId, opportunity_id: opp.id, title: "Story: the slump" }).select("id").single());
    const item = await must(
      alice.db
        .from("content_items")
        .insert({ project_id: projectId, opportunity_id: opp.id, story_id: story.id, title: "Slump short", stage: "review" })
        .select("id")
        .single(),
    );
    const scriptId = await addScript(alice, projectId, story.id, 1);
    await must(alice.db.rpc("record_approval", { p_checkpoint: "script", p_entity_id: scriptId, p_decision: "rejected" }));
    await must(alice.db.rpc("record_approval", { p_checkpoint: "script", p_entity_id: scriptId, p_decision: "approved" }));
    await must(alice.db.from("facts").insert({ project_id: projectId, story_id: story.id, claim: "Inter lost four home games in a row" }).select("id"));
    const plain = await idea(alice, projectId, "Loose idea");

    const res = await board(alice.db, projectId);
    expect(res.error).toBeNull();
    const card = res.data!.items.find((i) => i.id === item.id)!;
    expect(card).toMatchObject({
      stage: "review",
      storyId: story.id,
      storyTitle: "Story: the slump",
      storyStatus: "draft",
      opportunityId: opp.id,
      opportunityTitle: "Inter's home slump",
      opportunityScore: 82,
      scriptId,
      scriptVersion: 1,
      // latest decision by insertion order (seq), even within the same transaction time
      scriptDecision: "approved",
      blockers: ["1 critical fact(s) not confirmed"],
    });
    expect(Date.parse(card.stageChangedAt)).not.toBeNaN();
    // blockers are only computed for review/production/ready cards
    expect(res.data!.items.find((i) => i.id === plain)).toMatchObject({ stage: "idea", blockers: null, storyId: null, scriptId: null });
  });
});

describe("content workflow through the service", () => {
  let itemId: string;
  let storyId: string;

  it("moves idea → research → script → review freely", async () => {
    itemId = await idea(alice, projectA, "Bologna stun Inter", "How a mid-table side out-pressed the champions");
    for (const stage of ["research", "script", "review"] as const) {
      const res = await move(alice.db, { projectId: projectA, id: itemId, stage });
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ id: itemId, stage, changed: true });
      expect((await row(itemId)).stage).toBe(stage);
    }
  });

  it("refuses review → production while the item has no story, with a next step", async () => {
    const res = await move(alice.db, { projectId: projectA, id: itemId, stage: "production" });
    expect(guardCode(res.error)).toBe("SCRIPT_NOT_APPROVED");
    expect(res.error?.userMessage).toBe("Create the story and approve its current script before moving to production.");
    expect((await row(itemId)).stage).toBe("review");
  });

  it("creates the story from the item and links it (idempotent)", async () => {
    const res = await createStoryForItem(alice.db, { projectId: projectA, id: itemId, userId: alice.id });
    expect(res.error).toBeNull();
    expect(res.data!.existing).toBe(false);
    storyId = res.data!.storyId;

    const story = await must(alice.db.from("stories").select("title, logline, status, project_id, metadata").eq("id", storyId).single());
    expect(story).toMatchObject({
      title: "Bologna stun Inter",
      logline: "How a mid-table side out-pressed the champions",
      status: "draft",
      project_id: projectA,
    });
    expect(story.metadata).toMatchObject({ created_from: "content_item", content_item_id: itemId });
    expect((await row(itemId)).story_id).toBe(storyId);

    const again = await createStoryForItem(alice.db, { projectId: projectA, id: itemId, userId: alice.id });
    expect(again.data).toEqual({ storyId, existing: true });
    const { rows } = await pool.query("select count(*)::int as n from public.stories where project_id = $1 and title = $2", [projectA, "Bologna stun Inter"]);
    expect(rows[0].n).toBe(1);
  });

  it("builds the story from the opportunity's angle when the item came from one", async () => {
    const opp = await must(
      alice.db
        .from("opportunities")
        .insert({ project_id: projectA, title: "Derby week", angle: "The rivalry in numbers", why_now: "Derby on Sunday", hook: "Nobody expected this" })
        .select("id")
        .single(),
    );
    const item = await must(
      alice.db.from("content_items").insert({ project_id: projectA, opportunity_id: opp.id, title: "Derby short", stage: "research" }).select("id").single(),
    );
    const res = await createStoryForItem(alice.db, { projectId: projectA, id: item.id, userId: alice.id });
    expect(res.error).toBeNull();
    const story = await must(alice.db.from("stories").select("opportunity_id, angle, logline, metadata").eq("id", res.data!.storyId).single());
    expect(story).toMatchObject({ opportunity_id: opp.id, angle: "The rivalry in numbers", logline: "Derby on Sunday" });
    expect(story.metadata).toMatchObject({ hook: "Nobody expected this" });
  });

  it("refuses production while the current script awaits a decision, allows it after record_approval('script')", async () => {
    const scriptId = await addScript(alice, projectA, storyId, 1);

    const refused = await move(alice.db, { projectId: projectA, id: itemId, stage: "production" });
    expect(guardCode(refused.error)).toBe("SCRIPT_NOT_APPROVED");
    expect(refused.error?.userMessage).toBe("Approve the current script before moving to production.");
    expect((await row(itemId)).stage).toBe("review");

    await must(alice.db.rpc("record_approval", { p_checkpoint: "script", p_entity_id: scriptId, p_decision: "approved", p_notes: "Grounded" }));
    const res = await move(alice.db, { projectId: projectA, id: itemId, stage: "production" });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ stage: "production", from: "review" });
    expect((await row(itemId)).stage).toBe("production");
  });

  it("a new (unapproved) current script closes the gate again for the next stage", async () => {
    const other = await idea(alice, projectA, "Second cut");
    await move(alice.db, { projectId: projectA, id: other, stage: "review" });
    const story = await createStoryForItem(alice.db, { projectId: projectA, id: other, userId: alice.id });
    const v1 = await addScript(alice, projectA, story.data!.storyId, 1);
    await must(alice.db.rpc("record_approval", { p_checkpoint: "script", p_entity_id: v1, p_decision: "approved" }));
    await addScript(alice, projectA, story.data!.storyId, 2); // v2 is current, not approved
    const res = await move(alice.db, { projectId: projectA, id: other, stage: "production" });
    expect(guardCode(res.error)).toBe("SCRIPT_NOT_APPROVED");
  });

  it("refuses READY with an unconfirmed critical claim, and explains it in the detail", async () => {
    const fact = await must(
      alice.db.from("facts").insert({ project_id: projectA, story_id: storyId, claim: "Bologna had 62% possession", is_critical: true }).select("id").single(),
    );

    const refused = await move(alice.db, { projectId: projectA, id: itemId, stage: "ready" });
    expect(guardCode(refused.error)).toBe("CONTENT_NOT_READY");
    expect(refused.error?.userMessage).toMatch(/^Can't move to READY: 1 critical fact\(s\) not confirmed\. Resolve the blockers/);
    expect((await row(itemId)).stage).toBe("production");

    const d = await detail(alice.db, projectA, itemId);
    expect(d.error).toBeNull();
    expect(d.data!.blockers).toEqual(["1 critical fact(s) not confirmed"]);
    expect(d.data!.blockingFacts).toEqual([{ id: fact.id, claim: "Bologna had 62% possession", status: "uncertain", scope: "story" }]);

    // a person confirms it against a source → READY opens
    const source = await must(
      alice.db.from("sources").insert({ project_id: projectA, name: "Opta", title: "Match stats", url: `https://example.test/${randomUUID()}` }).select("id").single(),
    );
    await must(alice.db.from("fact_sources").insert({ project_id: projectA, fact_id: fact.id, source_id: source.id }).select("fact_id"));
    await must(alice.db.from("facts").update({ status: "confirmed" }).eq("id", fact.id).select("id").single());

    const res = await move(alice.db, { projectId: projectA, id: itemId, stage: "ready" });
    expect(res.error).toBeNull();
    expect((await row(itemId)).stage).toBe("ready");
  });

  it("returns the full detail: item, story, current script + decision, approvals history by seq", async () => {
    const d = await detail(alice.db, projectA, itemId);
    expect(d.error).toBeNull();
    const data = d.data!;
    expect(data.item).toMatchObject({ id: itemId, stage: "ready", story_id: storyId });
    expect(data.story).toMatchObject({ id: storyId, title: "Bologna stun Inter", status: "draft" });
    expect(data.storyDecision).toBeNull();
    expect(data.opportunity).toBeNull();
    expect(data.currentScript).toMatchObject({ version: 1, decision: { decision: "approved", notes: "Grounded" } });
    expect(data.scriptCount).toBe(1);
    expect(data.blockers).toEqual([]);
    expect(data.approvals.map((a) => [a.entityLabel, a.checkpoint, a.decision])).toEqual([["Script v1", "script", "approved"]]);
  });
});

describe("story checkpoint (STORY ≠ FOOTAGE)", () => {
  it("approves a story whose only footage is not cleared; the clip still blocks READY", async () => {
    const item = await idea(alice, projectA, "Story without footage");
    const story = await createStoryForItem(alice.db, { projectId: projectA, id: item, userId: alice.id });
    const storyId = story.data!.storyId;
    const video = await must(
      alice.db.from("videos").insert({ project_id: projectA, title: "Broadcast highlights", storage_path: `${projectA}/${randomUUID()}.mp4` }).select("id").single(),
    );
    await must(alice.db.from("clips").insert({ project_id: projectA, video_id: video.id, content_item_id: item, start_sec: 3, end_sec: 18 }).select("id"));

    const res = await decideStory(alice.db, { projectId: projectA, storyId, decision: "approved", notes: "Tell it with graphics and voiceover" });
    expect(res.error).toBeNull();
    expect(res.data!.status).toBe("approved");
    expect((await must(alice.db.from("stories").select("status").eq("id", storyId).single())).status).toBe("approved");

    const d = await detail(alice.db, projectA, item);
    expect(d.data!.storyDecision).toMatchObject({ decision: "approved", notes: "Tell it with graphics and voiceover" });
    expect(d.data!.storyDecision!.decidedBy).toBeTruthy();
    expect(d.data!.blockers).toEqual(["1 clip(s) use material not cleared for production (RED, unchecked or unapproved YELLOW)"]);
    expect(d.data!.blockingClips).toEqual([
      expect.objectContaining({ videoId: video.id, videoTitle: "Broadcast highlights", rightsStatus: "unchecked", status: "candidate" }),
    ]);

    // a later rejection is the latest decision (append-only history, newest first)
    const rejected = await decideStory(alice.db, { projectId: projectA, storyId, decision: "rejected", notes: null });
    expect(rejected.error).toBeNull();
    const after = await detail(alice.db, projectA, item);
    expect(after.data!.story!.status).toBe("rejected");
    expect(after.data!.storyDecision).toMatchObject({ decision: "rejected", notes: null });
    expect(after.data!.approvals.map((a) => [a.entityLabel, a.decision])).toEqual([
      ["Story", "rejected"],
      ["Story", "approved"],
    ]);
  });

  it("refuses an unknown story and a viewer's decision", async () => {
    const missing = await decideStory(alice.db, { projectId: projectA, storyId: randomUUID(), decision: "approved", notes: null });
    expect(guardCode(missing.error)).toBe("NOT_FOUND");

    const item = await idea(alice, projectA, "Viewer cannot approve");
    const story = await createStoryForItem(alice.db, { projectId: projectA, id: item, userId: alice.id });
    const res = await decideStory(carol.db, { projectId: projectA, storyId: story.data!.storyId, decision: "approved", notes: null });
    expect(res.error).not.toBeNull();
    expect((await must(alice.db.from("stories").select("status").eq("id", story.data!.storyId).single())).status).toBe("draft");
  });
});

describe("positions and edits", () => {
  it("places a drop between neighbours and renumbers a column of ties", async () => {
    const projectId = await newProject(alice, "Positions");
    // items created by start_production get the default position 0: a column of ties
    const ties = await must(
      alice.db
        .from("content_items")
        .insert([
          { project_id: projectId, title: "Tie 1", stage: "research" },
          { project_id: projectId, title: "Tie 2", stage: "research" },
        ])
        .select("id, title"),
    );
    // distinct creation times keep the tie order deterministic
    await pool.query("update public.content_items set created_at = now() - interval '1 hour' where id = $1", [ties.find((t) => t.title === "Tie 1")!.id]);
    const tie1 = ties.find((t) => t.title === "Tie 1")!.id;
    const tie2 = ties.find((t) => t.title === "Tie 2")!.id;
    const moving = await idea(alice, projectId, "Dropped between");

    const res = await move(alice.db, { projectId, id: moving, stage: "research", index: 1 });
    expect(res.error).toBeNull();
    expect(res.data!.renumbered).toBe(2);
    const order = async () =>
      groupByStage((await board(alice.db, projectId)).data!.items)
        .find((c) => c.stage === "research")!
        .items.map((i) => i.id);
    expect(await order()).toEqual([tie1, moving, tie2]);

    // within the column: midpoint between neighbours, no renumbering
    const reorder = await move(alice.db, { projectId, id: tie2, stage: "research", index: 1 });
    expect(reorder.error).toBeNull();
    expect(reorder.data).toMatchObject({ from: "research", stage: "research", renumbered: 0 });
    expect(await order()).toEqual([tie1, tie2, moving]);
    const p = await Promise.all([tie1, tie2, moving].map(async (id) => (await row(id)).position));
    expect(p[0]).toBeLessThan(p[1]);
    expect(p[1]).toBeLessThan(p[2]);

    // the stage selector left on the current stage: nothing changes (the card does not jump to the end)
    const same = await move(alice.db, { projectId, id: tie1, stage: "research" });
    expect(same.error).toBeNull();
    expect(same.data).toMatchObject({ changed: false, from: "research", stage: "research", position: p[0], renumbered: 0 });
    expect((await row(tie1)).position).toBe(p[0]);
    expect(await order()).toEqual([tie1, tie2, moving]);
  });

  it("updates title, format and description", async () => {
    const id = await idea(alice, projectA, "Old title", "Old description");
    const res = await updateItem(alice.db, { projectId: projectA, id, fields: { title: "New title", format: "long", description: null } });
    expect(res.error).toBeNull();
    expect(await row(id)).toMatchObject({ title: "New title", format: "long", description: null, stage: "idea" });
  });
});

describe("project isolation", () => {
  let aliceItem: string;
  let aliceStory: string;

  beforeAll(async () => {
    aliceItem = await idea(alice, projectA, "Alice's private item");
    aliceStory = (await createStoryForItem(alice.db, { projectId: projectA, id: aliceItem, userId: alice.id })).data!.storyId;
    await idea(bob, projectB, "Bob's item");
  });

  it("another project's member never sees the item (board, detail)", async () => {
    const bobBoard = await board(bob.db, projectB);
    expect(bobBoard.error).toBeNull();
    expect(bobBoard.data!.items.some((i) => i.id === aliceItem)).toBe(false);
    expect(bobBoard.data!.items.map((i) => i.title)).toEqual(["Bob's item"]);

    // asking for project A explicitly: RLS returns nothing
    expect((await board(bob.db, projectA)).data!.items).toEqual([]);
    expect(guardCode((await detail(bob.db, projectA, aliceItem)).error)).toBe("NOT_FOUND");
    // the item id under Bob's own project: the project filter returns nothing
    expect(guardCode((await detail(bob.db, projectB, aliceItem)).error)).toBe("NOT_FOUND");
    // Alice's board does not contain Bob's item
    expect((await board(alice.db, projectA)).data!.items.some((i) => i.title === "Bob's item")).toBe(false);
  });

  it("another project's member cannot move, edit, create a story for, or decide on the item", async () => {
    const before = await row(aliceItem);
    for (const projectId of [projectA, projectB]) {
      expect(guardCode((await move(bob.db, { projectId, id: aliceItem, stage: "research" })).error)).toBe("NOT_FOUND");
      expect(guardCode((await updateItem(bob.db, { projectId, id: aliceItem, fields: { title: "Hijacked", format: "post", description: null } })).error)).toBe(
        "NOT_FOUND",
      );
      expect(guardCode((await createStoryForItem(bob.db, { projectId, id: aliceItem, userId: bob.id })).error)).toBe("NOT_FOUND");
      expect(guardCode((await decideStory(bob.db, { projectId, storyId: aliceStory, decision: "approved", notes: null })).error)).toBe("NOT_FOUND");
    }
    expect(await row(aliceItem)).toEqual(before);
    const { rows } = await pool.query("select count(*)::int as n from public.approvals where entity_id = $1", [aliceStory]);
    expect(rows[0].n).toBe(0);
  });

  it("a viewer sees the board but cannot move or edit", async () => {
    const viewerBoard = await board(carol.db, projectA);
    expect(viewerBoard.data!.items.some((i) => i.id === aliceItem)).toBe(true);
    expect((await detail(carol.db, projectA, aliceItem)).error).toBeNull();

    expect(guardCode((await move(carol.db, { projectId: projectA, id: aliceItem, stage: "research" })).error)).toBe("NOT_FOUND");
    expect(guardCode((await updateItem(carol.db, { projectId: projectA, id: aliceItem, fields: { title: "Viewer edit", format: "short", description: null } })).error)).toBe(
      "NOT_FOUND",
    );
    expect(await row(aliceItem)).toMatchObject({ stage: "idea", title: "Alice's private item" });
    // a viewer cannot create ideas either (RLS insert)
    const res = await createIdea(carol.db, { projectId: projectA, userId: carol.id, input: { title: "Viewer idea", format: "short", description: null } });
    expect(res.error).not.toBeNull();
  });
});
