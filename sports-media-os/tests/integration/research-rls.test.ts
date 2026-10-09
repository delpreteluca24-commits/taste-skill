import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

/**
 * Research Workspace permissions at the database (RLS + stamps): what the
 * workspace UI relies on when it shows "needs an admin" or hides other
 * projects' research.
 *   viewer → read · editor → add/edit research, link/unlink sources · admin → delete items and claims
 */

afterAll(() => pool.end());

async function workspace(db: Db) {
  const owner = await db.createUser();
  const project = await createProject(db, owner);
  const viewer = await db.createUser();
  const editor = await db.createUser();
  const outsider = await db.createUser();
  await db.as(owner);
  await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'editor')", [project, viewer, editor]);
  const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'Derby') returning id", [project]);
  const source = await db.one<{ id: string }>("insert into public.sources (project_id, name, url) values ($1, 'Agency', $2) returning id", [
    project,
    `https://example.test/${project}/a`,
  ]);
  const fact = await db.one<{ id: string }>(
    "insert into public.facts (project_id, opportunity_id, claim, ai_suggestion) values ($1, $2, 'Derby sold out', '{\"suggestedStatus\":\"probable\"}') returning id",
    [project, opp.id],
  );
  const item = await db.one<{ id: string }>(
    "insert into public.research_items (project_id, opportunity_id, item_type, content) values ($1, $2, 'question', 'Attendance?') returning id",
    [project, opp.id],
  );
  return { owner, viewer, editor, outsider, project, opp: opp.id, source: source.id, fact: fact.id, item: item.id };
}

describe("research workspace permissions", () => {
  it("outsiders see nothing of the workspace (claims, AI suggestions, links, items)", () =>
    tx(async (db) => {
      const w = await workspace(db);
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id, relation) values ($1, $2, $3, 'mentions')", [w.project, w.fact, w.source]);
      await db.as(w.outsider);
      expect(await db.q("select id, ai_suggestion from public.facts where id = $1", [w.fact])).toEqual([]);
      expect(await db.q("select fact_id from public.fact_sources where fact_id = $1", [w.fact])).toEqual([]);
      expect(await db.q("select id from public.research_items where opportunity_id = $1", [w.opp])).toEqual([]);
      await db.fails(
        "insert into public.fact_sources (project_id, fact_id, source_id, relation) values ($1, $2, $3, 'supports')",
        [w.project, w.fact, w.source],
        /row-level security/,
      );
      // updates and deletes silently match nothing
      expect(await db.q("update public.facts set status = 'false' where id = $1 returning id", [w.fact])).toEqual([]);
      expect(await db.q("delete from public.fact_sources where fact_id = $1 returning fact_id", [w.fact])).toEqual([]);
    }));

  it("viewers read but cannot add claims, links or items", () =>
    tx(async (db) => {
      const w = await workspace(db);
      await db.as(w.viewer);
      expect(await db.q("select id from public.facts where id = $1", [w.fact])).toHaveLength(1);
      await db.fails("insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'x')", [w.project, w.opp], /row-level security/);
      await db.fails(
        "insert into public.fact_sources (project_id, fact_id, source_id) values ($1, $2, $3)",
        [w.project, w.fact, w.source],
        /row-level security/,
      );
      await db.fails(
        "insert into public.research_items (project_id, opportunity_id, item_type, content) values ($1, $2, 'note', 'x')",
        [w.project, w.opp],
        /row-level security/,
      );
      expect(await db.q("update public.research_items set metadata = '{\"answered\":true}' where id = $1 returning id", [w.item])).toEqual([]);
    }));

  it("editors research and unlink sources, but deleting items and claims needs an admin", () =>
    tx(async (db) => {
      const w = await workspace(db);
      await db.as(w.editor);
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id, relation) values ($1, $2, $3, 'supports')", [w.project, w.fact, w.source]);
      expect(await db.q("update public.research_items set metadata = '{\"answered\":true,\"answer\":\"80,018\"}' where id = $1 returning id", [w.item])).toHaveLength(1);
      expect(await db.q("delete from public.fact_sources where fact_id = $1 returning fact_id", [w.fact])).toHaveLength(1);
      expect(await db.q("delete from public.research_items where id = $1 returning id", [w.item])).toEqual([]);
      expect(await db.q("delete from public.facts where id = $1 returning id", [w.fact])).toEqual([]);
      await db.as(w.owner);
      expect(await db.q("delete from public.research_items where id = $1 returning id", [w.item])).toHaveLength(1);
    }));

  it("the database stamps who verified a claim; a client cannot claim to be an agent or someone else", () =>
    tx(async (db) => {
      const w = await workspace(db);
      await db.as(w.editor);
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id, relation) values ($1, $2, $3, 'supports')", [w.project, w.fact, w.source]);
      await db.q("update public.facts set status = 'confirmed', confidence = 0.9, checked_by = $2, checked_by_agent = 'fact_checker' where id = $1", [
        w.fact,
        w.owner,
      ]);
      const row = await db.one<{ status: string; checked_by: string; checked_by_agent: string | null }>(
        "select status, checked_by, checked_by_agent from public.facts where id = $1",
        [w.fact],
      );
      expect(row).toEqual({ status: "confirmed", checked_by: w.editor, checked_by_agent: null });
    }));
});
