import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

/**
 * Database behaviour the Content Kanban relies on (SQL level, one rolled-back
 * transaction per test): content items and their READY blockers are visible to
 * project members only, viewers cannot change them, an item can never be linked
 * to another project's story, and a reorder inside a column (position only)
 * neither re-runs the gates nor resets the stage age.
 */

afterAll(() => pool.end());

async function setup(db: Db) {
  const owner = await db.createUser();
  const viewer = await db.createUser();
  const outsider = await db.createUser();
  const project = await createProject(db, owner, "Content");
  const other = await createProject(db, outsider, "Other");

  await db.as(owner);
  await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')", [project, viewer]);
  const story = await db.one<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'Story') returning id", [project]);
  const item = await db.one<{ id: string }>(
    "insert into public.content_items (project_id, story_id, title, stage) values ($1, $2, 'Card', 'review') returning id",
    [project, story.id],
  );
  await db.as(outsider);
  const otherStory = await db.one<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'Foreign story') returning id", [other]);
  return { owner, viewer, outsider, project, other, story: story.id, item: item.id, otherStory: otherStory.id };
}

describe("content items: project isolation", () => {
  it("another project's member cannot see, change or inspect the item", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.as(s.outsider);

      expect(await db.q("select id from public.content_items where id = $1", [s.item])).toEqual([]);
      expect(await db.q("update public.content_items set title = 'Hijacked', stage = 'idea' where id = $1 returning id", [s.item])).toEqual([]);
      expect(await db.q("delete from public.content_items where id = $1 returning id", [s.item])).toEqual([]);
      await db.fails("select public.content_item_blockers($1)", [s.item], /NOT_FOUND/);
      await db.fails("insert into public.content_items (project_id, title) values ($1, 'Planted')", [s.project], /row-level security|42501/);

      await db.asAdmin();
      expect(await db.one("select title, stage from public.content_items where id = $1", [s.item])).toEqual({ title: "Card", stage: "review" });
    }));

  it("a viewer reads the item and its blockers but cannot change it", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.as(s.viewer);

      expect(await db.q("select id from public.content_items where id = $1", [s.item])).toEqual([{ id: s.item }]);
      expect(await db.one("select public.content_item_blockers($1) as b", [s.item])).toEqual({ b: [] });
      expect(await db.q("update public.content_items set stage = 'script', position = 5 where id = $1 returning id", [s.item])).toEqual([]);
      expect(await db.q("delete from public.content_items where id = $1 returning id", [s.item])).toEqual([]);
      await db.fails("insert into public.content_items (project_id, title) values ($1, 'Viewer idea')", [s.project], /row-level security|42501/);
      await db.fails("select public.record_approval('story', $1, 'approved', null)", [s.story], /row-level security|42501/);

      await db.asAdmin();
      expect(await db.one("select stage from public.content_items where id = $1", [s.item])).toEqual({ stage: "review" });
    }));

  it("never links an item to another project's story", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.as(s.owner);
      await db.fails("update public.content_items set story_id = $2 where id = $1", [s.item, s.otherStory], /23503|foreign key/);
      await db.fails(
        "insert into public.content_items (project_id, story_id, title) values ($1, $2, 'Cross-linked')",
        [s.project, s.otherStory],
        /23503|foreign key/,
      );
    }));
});

describe("content items: reorder vs. move", () => {
  it("a reorder inside a gated column keeps the stage age and does not re-run the gates; a move does", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.as(s.owner);
      const script = await db.one<{ id: string }>(
        "insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'Hook', true) returning id",
        [s.project, s.story],
      );
      await db.q("select public.record_approval('script', $1, 'approved', null)", [script.id]);
      await db.q("update public.content_items set stage = 'ready' where id = $1", [s.item]);
      await db.asAdmin();
      await db.q("update public.content_items set stage_changed_at = now() - interval '3 days' where id = $1", [s.item]);
      const before = await db.one<{ stage_changed_at: Date }>("select stage_changed_at from public.content_items where id = $1", [s.item]);

      // a new unconfirmed critical claim appears after the item reached READY
      await db.as(s.owner);
      await db.q("insert into public.facts (project_id, story_id, claim, is_critical) values ($1, $2, 'Unverified record', true)", [s.project, s.story]);

      // reorder within READY: position only → allowed, stage age untouched
      const reordered = await db.one<{ stage: string; position: number; stage_changed_at: Date }>(
        "update public.content_items set position = 4096 where id = $1 returning stage, position, stage_changed_at",
        [s.item],
      );
      expect(reordered).toMatchObject({ stage: "ready", position: 4096 });
      expect(reordered.stage_changed_at.getTime()).toBe(before.stage_changed_at.getTime());

      // moving on to SCHEDULED re-runs the READY gate
      await db.fails("update public.content_items set stage = 'scheduled' where id = $1", [s.item], /CONTENT_NOT_READY: 1 critical fact/);

      // moving back is always allowed and restarts the stage age
      const back = await db.one<{ stage_changed_at: Date }>(
        "update public.content_items set stage = 'review', position = 1024 where id = $1 returning stage_changed_at",
        [s.item],
      );
      expect(back.stage_changed_at.getTime()).toBeGreaterThan(before.stage_changed_at.getTime());
    }));
});
