import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

async function base(db: Db) {
  const user = await db.createUser();
  const project = await createProject(db, user);
  await db.as(user);
  const opp = await db.one<{ id: string }>(
    "insert into public.opportunities (project_id, title, angle, hook, why_now) values ($1, 'Underdog run', 'Data angle', 'Nobody saw it', 'Final tonight') returning id",
    [project],
  );
  return { user, project, opp: opp.id };
}

describe("start_production (atomic)", () => {
  it("creates story + content item once, then returns the same item", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.q("select public.record_approval('opportunity', $1, 'approved', null)", [b.opp]);
      const first = await db.one<{ content_item_id: string; story_id: string; existing: boolean }>("select * from public.start_production($1)", [b.opp]);
      expect(first.existing).toBe(false);
      const again = await db.one<{ content_item_id: string; existing: boolean }>("select * from public.start_production($1)", [b.opp]);
      expect(again).toMatchObject({ content_item_id: first.content_item_id, existing: true });
      expect(await db.q("select stage, format from public.content_items where opportunity_id = $1", [b.opp])).toEqual([{ stage: "research", format: "short" }]);
      expect((await db.one<{ status: string }>("select status from public.opportunities where id = $1", [b.opp])).status).toBe("production");
    }));

  it("refuses an unapproved opportunity and another project's opportunity", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.fails("select * from public.start_production($1)", [b.opp], /APPROVAL_REQUIRED/);
      const outsider = await db.createUser();
      await createProject(db, outsider);
      await db.as(outsider);
      await db.fails("select * from public.start_production($1)", [b.opp], /NOT_FOUND/);
    }));
});

describe("create_story_for_content_item (atomic)", () => {
  it("builds the story from the item (and its opportunity) once", () =>
    tx(async (db) => {
      const b = await base(db);
      const item = await db.one<{ id: string }>(
        "insert into public.content_items (project_id, opportunity_id, title, description) values ($1, $2, 'Derby comeback', 'Three goals down') returning id",
        [b.project, b.opp],
      );
      const first = await db.one<{ story_id: string; existing: boolean }>("select * from public.create_story_for_content_item($1)", [item.id]);
      expect(first.existing).toBe(false);
      const story = await db.one<{ title: string; logline: string; angle: string; metadata: Record<string, unknown> }>(
        "select title, logline, angle, metadata from public.stories where id = $1",
        [first.story_id],
      );
      expect(story).toMatchObject({ title: "Derby comeback", logline: "Three goals down", angle: "Data angle" });
      expect(story.metadata).toMatchObject({ created_from: "content_item", content_item_id: item.id, hook: "Nobody saw it" });
      const again = await db.one<{ story_id: string; existing: boolean }>("select * from public.create_story_for_content_item($1)", [item.id]);
      expect(again).toEqual({ story_id: first.story_id, existing: true });
      expect((await db.one<{ n: number }>("select count(*)::int as n from public.stories where project_id = $1", [b.project])).n).toBe(1);
    }));

  it("an outsider gets NOT_FOUND and creates nothing", () =>
    tx(async (db) => {
      const b = await base(db);
      const item = await db.one<{ id: string }>("insert into public.content_items (project_id, title) values ($1, 'Idea') returning id", [b.project]);
      const outsider = await db.createUser();
      await createProject(db, outsider);
      await db.as(outsider);
      await db.fails("select * from public.create_story_for_content_item($1)", [item.id], /NOT_FOUND/);
      await db.asAdmin();
      expect((await db.one<{ story_id: string | null }>("select story_id from public.content_items where id = $1", [item.id])).story_id).toBeNull();
    }));
});

describe("content_items_blockers (batch)", () => {
  it("lists READY blockers for many items of the project and nothing for other projects", () =>
    tx(async (db) => {
      const b = await base(db);
      const items = await db.q<{ id: string }>(
        "insert into public.content_items (project_id, opportunity_id, title) values ($1, $2, 'A'), ($1, null, 'B') returning id",
        [b.project, b.opp],
      );
      await db.q("insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'Unbeaten in 12 away games')", [b.project, b.opp]);
      const rows = await db.q<{ content_item_id: string; blockers: string[] }>("select * from public.content_items_blockers($1, $2)", [
        b.project,
        items.map((i) => i.id),
      ]);
      const byId = new Map(rows.map((r) => [r.content_item_id, r.blockers]));
      expect(byId.get(items[0].id)?.join(" ")).toMatch(/critical/i);
      expect(byId.get(items[1].id)).toEqual([]);

      const outsider = await db.createUser();
      const other = await createProject(db, outsider);
      await db.as(outsider);
      expect(await db.q("select * from public.content_items_blockers($1, $2)", [b.project, items.map((i) => i.id)])).toEqual([]);
      expect(await db.q("select * from public.content_items_blockers($1, $2)", [other, items.map((i) => i.id)])).toEqual([]);
    }));
});

describe("ai_usage_summary", () => {
  it("reports cache tokens and exact unpriced calls per task/model", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.asAdmin();
      await db.q(
        `insert into public.ai_usage (project_id, task, provider, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
         values ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'success', 1000, 200, 300, 50, 0.0002),
                ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'success', 500, 100, 0, 0, null),
                ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'error', 0, 0, 0, 0, null)`,
        [b.project],
      );
      await db.as(b.user);
      const [row] = await db.q<Record<string, string>>("select * from public.ai_usage_summary($1, 30)", [b.project]);
      expect(row).toMatchObject({ calls: "3", errors: "1", cache_read_tokens: "300", cache_write_tokens: "50", unpriced_calls: "1" });
      expect(Number(row.cost_usd)).toBeCloseTo(0.0002, 6);
    }));
});
