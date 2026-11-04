import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

/**
 * Project isolation for the Opportunity Engine at the SQL level (each test is a
 * rolled-back transaction): RLS hides other projects' opportunities and research,
 * composite FKs refuse cross-project links, and only members decide.
 */
async function twoProjects(db: Db) {
  const alice = await db.createUser();
  const bob = await db.createUser();
  const a = await createProject(db, alice, "A");
  await db.as(alice);
  const oppA = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'A opp') returning id", [a]);
  const trendA = await db.one<{ id: string }>("insert into public.trends (project_id, title) values ($1, 'A trend') returning id", [a]);
  const sourceA = await db.one<{ id: string }>("insert into public.sources (project_id, name, url) values ($1, 'A src', $2) returning id", [
    a,
    `https://example.test/${a}`,
  ]);
  await db.q("insert into public.research_items (project_id, opportunity_id, source_id, item_type, title) values ($1, $2, $3, 'article', 'A article')", [
    a,
    oppA.id,
    sourceA.id,
  ]);
  const b = await createProject(db, bob, "B");
  await db.as(bob);
  const oppB = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'B opp') returning id", [b]);
  return { alice, bob, a, b, oppA: oppA.id, oppB: oppB.id, trendA: trendA.id, sourceA: sourceA.id };
}

describe("opportunities — project isolation", () => {
  it("other projects cannot read opportunities or their research", () =>
    tx(async (db) => {
      const p = await twoProjects(db);
      await db.as(p.bob);
      expect(await db.q("select id from public.opportunities where id = $1", [p.oppA])).toHaveLength(0);
      expect(await db.q("select id from public.research_items where opportunity_id = $1", [p.oppA])).toHaveLength(0);
      expect(await db.q("select id from public.opportunities")).toEqual([{ id: p.oppB }]);
    }));

  it("other projects cannot change scores or status (0 rows) nor add research to them", () =>
    tx(async (db) => {
      const p = await twoProjects(db);
      await db.as(p.bob);
      expect(await db.q("update public.opportunities set opportunity_score = 1, curiosity_score = 1 where id = $1 returning id", [p.oppA])).toHaveLength(0);
      await db.fails(
        "insert into public.research_items (project_id, opportunity_id, item_type, title) values ($1, $2, 'note', 'x')",
        [p.a, p.oppA],
        /row-level security/,
      );
      await db.asAdmin();
      expect((await db.one<{ curiosity_score: string | null }>("select curiosity_score from public.opportunities where id = $1", [p.oppA])).curiosity_score).toBeNull();
    }));

  it("composite FKs refuse cross-project links (trend, research source)", () =>
    tx(async (db) => {
      const p = await twoProjects(db);
      // even the service role (worker) cannot link B's opportunity to A's trend or A's source
      await db.asAdmin();
      await db.fails("insert into public.opportunities (project_id, title, trend_id) values ($1, 'x', $2)", [p.b, p.trendA], /foreign key/);
      await db.fails(
        "insert into public.research_items (project_id, opportunity_id, source_id, item_type) values ($1, $2, $3, 'article')",
        [p.b, p.oppB, p.sourceA],
        /foreign key/,
      );
      await db.fails(
        "insert into public.content_items (project_id, opportunity_id, title) values ($1, $2, 'x')",
        [p.b, p.oppA],
        /foreign key/,
      );
    }));

  it("only members decide: strangers get NOT_FOUND, viewers are refused, editors decide", () =>
    tx(async (db) => {
      const p = await twoProjects(db);
      await db.as(p.bob);
      await db.fails("select public.record_approval('opportunity', $1, 'approved', null)", [p.oppA], /NOT_FOUND/);

      const viewer = await db.createUser();
      const editor = await db.createUser();
      await db.as(p.alice);
      await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'editor')", [p.a, viewer, editor]);
      await db.as(viewer);
      expect(await db.q("select id from public.opportunities where id = $1", [p.oppA])).toHaveLength(1);
      await db.fails("select public.record_approval('opportunity', $1, 'approved', null)", [p.oppA], /row-level security|APPROVAL_REQUIRED/);

      await db.as(editor);
      await db.q("select public.record_approval('opportunity', $1, 'approved', 'solid angle')", [p.oppA]);
      expect((await db.one<{ status: string }>("select status from public.opportunities where id = $1", [p.oppA])).status).toBe("approved");
      // production is a workflow status after approval; approved/rejected need a decision
      await db.q("update public.opportunities set status = 'production' where id = $1", [p.oppA]);
      await db.fails("update public.opportunities set status = 'rejected' where id = $1", [p.oppA], /APPROVAL_REQUIRED/);
    }));
});
