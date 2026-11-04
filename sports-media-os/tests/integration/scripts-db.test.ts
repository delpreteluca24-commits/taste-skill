import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

/**
 * Script Studio & Hook Studio — the database contract the module relies on
 * (each test is one rolled-back transaction, impersonating users like PostgREST).
 */

afterAll(() => pool.end());

async function setup(db: Db) {
  const owner = await db.createUser();
  const project = await createProject(db, owner);
  await db.as(owner);
  const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'Bologna stun Inter') returning id", [project]);
  const story = await db.one<{ id: string }>("insert into public.stories (project_id, opportunity_id, title) values ($1, $2, 'Story') returning id", [
    project,
    opp.id,
  ]);
  const content = await db.one<{ id: string }>(
    "insert into public.content_items (project_id, opportunity_id, story_id, title, stage) values ($1, $2, $3, 'Short', 'script') returning id",
    [project, opp.id, story.id],
  );
  return { owner, project, opp: opp.id, story: story.id, content: content.id };
}

/** a version as the worker / service inserts it: no version number (the trigger assigns it) */
async function version(db: Db, s: { project: string; story: string }, over: { operation?: string; parent?: string | null; current?: boolean; hook?: string; angle?: string | null } = {}) {
  return db.one<{ id: string; version: number; is_current: boolean }>(
    `insert into public.scripts (project_id, story_id, operation, parent_script_id, angle, hook, full_text, facts_used, warnings, is_current)
     values ($1, $2, $3, $4, $5, $6, $6, '{}', '{}', $7) returning id, version, is_current`,
    [s.project, s.story, over.operation ?? "generate", over.parent ?? null, over.angle === undefined ? "analysis" : over.angle, over.hook ?? "Hook", over.current ?? false],
  );
}

describe("versions are immutable rows", () => {
  it("a manual edit is a NEW version: number assigned by the DB, parent kept, the old version untouched", () =>
    tx(async (db) => {
      const s = await setup(db);
      const v1 = await version(db, s, { current: true, hook: "Original hook" });
      const v2 = await version(db, s, { operation: "manual", parent: v1.id, current: true, hook: "Edited hook" });
      expect([v1.version, v2.version]).toEqual([1, 2]);

      const rows = await db.q<{ version: number; hook: string; is_current: boolean; parent_script_id: string | null; operation: string }>(
        "select version, hook, is_current, parent_script_id, operation from public.scripts where story_id = $1 order by version",
        [s.story],
      );
      expect(rows).toEqual([
        { version: 1, hook: "Original hook", is_current: false, parent_script_id: null, operation: "generate" },
        { version: 2, hook: "Edited hook", is_current: true, parent_script_id: v1.id, operation: "manual" },
      ]);

      await db.fails("update public.scripts set hook = 'sneaky edit' where id = $1", [v1.id], /SCRIPT_IMMUTABLE/);
      await db.fails("update public.scripts set warnings = '{}', facts_used = '{}' , angle = 'controversy' where id = $1", [v2.id], /SCRIPT_IMMUTABLE/);
      // no deleting history either (only a story delete cascades)
      await db.fails("delete from public.scripts where id = $1", [v1.id], /permission denied/);
    }));

  it("switching the current version is an update of is_current only — one current per story", () =>
    tx(async (db) => {
      const s = await setup(db);
      const v1 = await version(db, s, { current: true });
      const v2 = await version(db, s, { current: false, angle: "storytelling" });
      await db.q("update public.scripts set is_current = true where id = $1", [v2.id]);
      expect(await db.q("select id from public.scripts where story_id = $1 and is_current", [s.story])).toEqual([{ id: v2.id }]);
      await db.fails("update public.scripts set is_current = true, hook = 'x' where id = $1", [v1.id], /SCRIPT_IMMUTABLE/);
    }));
});

describe("SCRIPT → APPROVAL", () => {
  it("production needs the CURRENT version approved; a new current version needs its own approval", () =>
    tx(async (db) => {
      const s = await setup(db);
      const v1 = await version(db, s, { current: true });
      await db.q("select public.record_approval('script', $1, 'approved', 'facts checked')", [v1.id]);
      await db.q("update public.content_items set stage = 'production' where id = $1", [s.content]);
      await db.q("update public.content_items set stage = 'script' where id = $1", [s.content]);

      // an AI rewrite made current: not approved yet
      const v2 = await version(db, s, { operation: "shorten", parent: v1.id, current: true });
      await db.fails("update public.content_items set stage = 'production' where id = $1", [s.content], /SCRIPT_NOT_APPROVED/);
      // switching back to the approved version unblocks it
      await db.q("update public.scripts set is_current = true where id = $1", [v1.id]);
      await db.q("update public.content_items set stage = 'production' where id = $1", [s.content]);
      expect(v2.version).toBe(2);
    }));

  it("the latest decision wins (insertion order), and only a signed-in editor can record one", () =>
    tx(async (db) => {
      const s = await setup(db);
      const v1 = await version(db, s, { current: true });
      await db.q("select public.record_approval('script', $1, 'approved', null)", [v1.id]);
      await db.q("select public.record_approval('script', $1, 'rejected', 'number in the payoff is not in the facts')", [v1.id]);
      await db.fails("update public.content_items set stage = 'production' where id = $1", [s.content], /SCRIPT_NOT_APPROVED/);
      const latest = await db.one<{ decision: string; notes: string }>(
        "select decision, notes from public.approvals where entity_type = 'script' and entity_id = $1 order by seq desc limit 1",
        [v1.id],
      );
      expect(latest).toEqual({ decision: "rejected", notes: "number in the payoff is not in the facts" });

      // a viewer cannot approve
      const viewer = await db.createUser();
      await db.asAdmin();
      await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')", [s.project, viewer]);
      await db.as(viewer);
      await db.fails("select public.record_approval('script', $1, 'approved', null)", [v1.id], /row-level security|permission denied|NOT_FOUND/);

      // an agent / worker (no signed-in person) never approves
      await db.asAdmin();
      await db.fails("select public.record_approval('script', $1, 'approved', null)", [v1.id], /APPROVAL_REQUIRES_HUMAN/);
    }));
});

describe("hooks", () => {
  it("keep ONE selected hook per story", () =>
    tx(async (db) => {
      const s = await setup(db);
      const ids = [];
      for (const [type, text] of [
        ["curiosity", "Why Bologna's press worked"],
        ["statistical", "3-0 at San Siro"],
      ]) {
        ids.push(
          (
            await db.one<{ id: string }>(
              "insert into public.hooks (project_id, story_id, opportunity_id, hook_type, text, score, score_explanation) values ($1, $2, $3, $4, $5, 70, '{}') returning id",
              [s.project, s.story, s.opp, type, text],
            )
          ).id,
        );
      }
      await db.q("update public.hooks set is_selected = true where id = $1", [ids[0]]);
      await db.q("update public.hooks set is_selected = true where id = $1", [ids[1]]);
      expect(await db.q("select id from public.hooks where story_id = $1 and is_selected", [s.story])).toEqual([{ id: ids[1] }]);
    }));
});

describe("project isolation", () => {
  it("a member of another project cannot read, add versions to, approve or select anything of this story", () =>
    tx(async (db) => {
      const a = await setup(db);
      const v1 = await version(db, a, { current: true });
      const hook = await db.one<{ id: string }>(
        "insert into public.hooks (project_id, story_id, hook_type, text) values ($1, $2, 'story', 'One night at San Siro') returning id",
        [a.project, a.story],
      );
      const b = await setup(db); // as B's owner from here on

      expect(await db.q("select id from public.scripts where story_id = $1", [a.story])).toEqual([]);
      expect(await db.q("select id from public.hooks where story_id = $1", [a.story])).toEqual([]);
      await db.fails(
        "insert into public.scripts (project_id, story_id, hook, operation) values ($1, $2, 'x', 'manual')",
        [a.project, a.story],
        // the version trigger cannot see A's story (RLS) → NOT_FOUND before the RLS check
        /NOT_FOUND|row-level security/,
      );
      // B's project id with A's story: the story is not in B's project → a clear NOT_FOUND
      await db.fails(
        "insert into public.scripts (project_id, story_id, hook, operation) values ($1, $2, 'x', 'manual')",
        [b.project, a.story],
        /NOT_FOUND: story not found in this project/,
      );
      await db.fails("select public.record_approval('script', $1, 'approved', null)", [v1.id], /NOT_FOUND/);
      expect(await db.q("update public.scripts set is_current = true where id = $1 returning id", [v1.id])).toEqual([]);
      expect(await db.q("update public.hooks set is_selected = true where id = $1 returning id", [hook.id])).toEqual([]);
      await db.fails(
        "insert into public.hooks (project_id, story_id, hook_type, text) values ($1, $2, 'story', 'x')",
        [b.project, a.story],
        /23503|foreign key/,
      );
    }));
});
