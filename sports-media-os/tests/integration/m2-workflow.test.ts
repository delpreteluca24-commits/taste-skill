import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

async function base(db: Db) {
  const user = await db.createUser();
  const project = await createProject(db, user);
  await db.as(user);
  const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'Underdog run') returning id", [project]);
  const source = await db.one<{ id: string }>(
    "insert into public.sources (project_id, name, url) values ($1, 'Agency', $2) returning id",
    [project, `https://example.test/${project}/a`],
  );
  return { user, project, opp: opp.id, source: source.id };
}

describe("claims ↔ sources", () => {
  it("links a claim to several sources with relation and excerpt", () =>
    tx(async (db) => {
      const b = await base(db);
      const second = await db.one<{ id: string }>("insert into public.sources (project_id, name, url) values ($1, 'Club', $2) returning id", [
        b.project,
        `https://example.test/${b.project}/b`,
      ]);
      const fact = await db.one<{ id: string }>(
        "insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'Unbeaten in 12 away games') returning id",
        [b.project, b.opp],
      );
      await db.q(
        "insert into public.fact_sources (project_id, fact_id, source_id, relation, excerpt) values ($1, $2, $3, 'supports', '12 away games without defeat'), ($1, $2, $4, 'contradicts', 'lost at Bergamo in March')",
        [b.project, fact.id, b.source, second.id],
      );
      const links = await db.q<{ relation: string }>("select relation from public.fact_sources where fact_id = $1 order by relation", [fact.id]);
      expect(links.map((l) => l.relation)).toEqual(["supports", "contradicts"]);
    }));

  it("refuses to confirm a critical claim without a supporting source", () =>
    tx(async (db) => {
      const b = await base(db);
      const fact = await db.one<{ id: string }>(
        "insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'Record attendance') returning id",
        [b.project, b.opp],
      );
      await db.fails("update public.facts set status = 'confirmed' where id = $1", [fact.id], /CLAIM_UNSOURCED/);
      await db.fails(
        "insert into public.facts (project_id, opportunity_id, claim, status) values ($1, $2, 'direct confirm', 'confirmed')",
        [b.project, b.opp],
        /CLAIM_UNSOURCED/,
      );
      // a 'mentions' link is not evidence
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id, relation) values ($1, $2, $3, 'mentions')", [
        b.project,
        fact.id,
        b.source,
      ]);
      await db.fails("update public.facts set status = 'confirmed' where id = $1", [fact.id], /CLAIM_UNSOURCED/);
      await db.q("update public.fact_sources set relation = 'supports' where fact_id = $1", [fact.id]);
      await db.q("update public.facts set status = 'confirmed' where id = $1", [fact.id]);
      // non-critical claims may be confirmed without a source
      await db.q("insert into public.facts (project_id, opportunity_id, claim, status, is_critical) values ($1, $2, 'minor', 'confirmed', false)", [
        b.project,
        b.opp,
      ]);
    }));

  it("downgrades a confirmed claim when its last supporting source is removed", () =>
    tx(async (db) => {
      const b = await base(db);
      const fact = await db.one<{ id: string }>("insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'c') returning id", [
        b.project,
        b.opp,
      ]);
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id) values ($1, $2, $3)", [b.project, fact.id, b.source]);
      await db.q("update public.facts set status = 'confirmed' where id = $1", [fact.id]);
      await db.q("delete from public.fact_sources where fact_id = $1", [fact.id]);
      expect((await db.one<{ status: string }>("select status from public.facts where id = $1", [fact.id])).status).toBe("uncertain");
    }));

  it("never links a claim to another project's source", () =>
    tx(async (db) => {
      const b = await base(db);
      const otherProject = await createProject(db, b.user, "Other");
      await db.as(b.user);
      const foreign = await db.one<{ id: string }>("insert into public.sources (project_id, name, url) values ($1, 'X', 'https://example.test/x') returning id", [
        otherProject,
      ]);
      const fact = await db.one<{ id: string }>("insert into public.facts (project_id, opportunity_id, claim) values ($1, $2, 'c') returning id", [
        b.project,
        b.opp,
      ]);
      await db.fails("insert into public.fact_sources (project_id, fact_id, source_id) values ($1, $2, $3)", [b.project, fact.id, foreign.id], /foreign key/);
    }));

  it("requires attribution for quotes, media and competitor items", () =>
    tx(async (db) => {
      const b = await base(db);
      for (const type of ["quote", "media", "competitor"]) {
        await db.fails(
          "insert into public.research_items (project_id, opportunity_id, item_type, content) values ($1, $2, $3, 'unattributed')",
          [b.project, b.opp, type],
          /research_items_attribution_check/,
        );
      }
      await db.q(
        "insert into public.research_items (project_id, opportunity_id, item_type, content, source_id) values ($1, $2, 'quote', '\"We believe\"', $3)",
        [b.project, b.opp, b.source],
      );
    }));
});

describe("human approval checkpoints", () => {
  it("OPPORTUNITY → APPROVAL: status changes only through a recorded decision", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.fails("update public.opportunities set status = 'approved' where id = $1", [b.opp], /APPROVAL_REQUIRED/);
      await db.fails(
        "insert into public.opportunities (project_id, title, status) values ($1, 'sneaky', 'approved')",
        [b.project],
        /APPROVAL_REQUIRED/,
      );
      const a = await db.one<{ decided_by: string; checkpoint: string }>(
        "select decided_by, checkpoint from public.record_approval('opportunity', $1, 'approved', 'great angle')",
        [b.opp],
      );
      expect(a).toEqual({ decided_by: b.user, checkpoint: "opportunity" });
      expect((await db.one<{ status: string }>("select status from public.opportunities where id = $1", [b.opp])).status).toBe("approved");
      // later workflow statuses don't need a new decision
      await db.q("update public.opportunities set status = 'production' where id = $1", [b.opp]);
    }));

  it("approvals require a signed-in human (no automated approvals)", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.asAdmin();
      await db.fails("select public.record_approval('opportunity', $1, 'approved', null)", [b.opp], /APPROVAL_REQUIRES_HUMAN/);
    }));

  it("viewers cannot approve; other projects cannot see the item", () =>
    tx(async (db) => {
      const b = await base(db);
      const viewer = await db.createUser();
      const stranger = await db.createUser();
      await db.as(b.user);
      await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')", [b.project, viewer]);
      await db.as(viewer);
      await db.fails("select public.record_approval('opportunity', $1, 'approved', null)", [b.opp], /row-level security|APPROVAL_REQUIRED/);
      await db.as(stranger);
      await db.fails("select public.record_approval('opportunity', $1, 'approved', null)", [b.opp], /NOT_FOUND/);
    }));
});

describe("content workflow", () => {
  async function production(db: Db) {
    const b = await base(db);
    const story = await db.one<{ id: string }>("insert into public.stories (project_id, opportunity_id, title) values ($1, $2, 'S') returning id", [
      b.project,
      b.opp,
    ]);
    const content = await db.one<{ id: string }>(
      "insert into public.content_items (project_id, opportunity_id, story_id, title) values ($1, $2, $3, 'C') returning id",
      [b.project, b.opp, story.id],
    );
    return { ...b, story: story.id, content: content.id };
  }

  it("moves freely through IDEA → RESEARCH → SCRIPT → REVIEW", () =>
    tx(async (db) => {
      const p = await production(db);
      for (const stage of ["research", "script", "review", "idea", "review"]) {
        await db.q("update public.content_items set stage = $2 where id = $1", [p.content, stage]);
      }
    }));

  it("SCRIPT → APPROVAL: PRODUCTION needs an approved current script", () =>
    tx(async (db) => {
      const p = await production(db);
      await db.fails("update public.content_items set stage = 'production' where id = $1", [p.content], /SCRIPT_NOT_APPROVED/);
      const v1 = await db.one<{ id: string }>("insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'v1', true) returning id", [
        p.project,
        p.story,
      ]);
      await db.fails("update public.content_items set stage = 'production' where id = $1", [p.content], /SCRIPT_NOT_APPROVED/);
      await db.q("select public.record_approval('script', $1, 'approved', null)", [v1.id]);
      await db.q("update public.content_items set stage = 'production' where id = $1", [p.content]);

      // a new current version needs its own approval before re-entering production
      await db.q("update public.content_items set stage = 'review' where id = $1", [p.content]);
      await db.q("insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'v2', true)", [p.project, p.story]);
      await db.fails("update public.content_items set stage = 'production' where id = $1", [p.content], /SCRIPT_NOT_APPROVED/);
    }));

  it("a rejected script blocks production", () =>
    tx(async (db) => {
      const p = await production(db);
      const v1 = await db.one<{ id: string }>("insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'v1', true) returning id", [
        p.project,
        p.story,
      ]);
      await db.q("select public.record_approval('script', $1, 'rejected', 'invented stat in payoff')", [v1.id]);
      await db.fails("update public.content_items set stage = 'production' where id = $1", [p.content], /SCRIPT_NOT_APPROVED/);
    }));

  it("content without a story cannot reach production", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.fails("insert into public.content_items (project_id, title, stage) values ($1, 'x', 'production')", [b.project], /SCRIPT_NOT_APPROVED/);
    }));

  it("script versions stay immutable and carry angle + facts used", () =>
    tx(async (db) => {
      const p = await production(db);
      const v = await db.one<{ id: string; version: number; angle: string }>(
        "insert into public.scripts (project_id, story_id, angle, hook, facts_used, operation, is_current) values ($1, $2, 'analysis', 'h', $3, 'generate', true) returning id, version, angle",
        [p.project, p.story, [p.opp]],
      );
      expect(v).toMatchObject({ version: 1, angle: "analysis" });
      await db.fails("update public.scripts set angle = 'controversy' where id = $1", [v.id], /SCRIPT_IMMUTABLE/);
      await db.fails("update public.scripts set facts_used = '{}' where id = $1", [v.id], /SCRIPT_IMMUTABLE/);
    }));
});

describe("AI ledger", () => {
  it("is readable by members, not writable by users, and summarised per task/model", () =>
    tx(async (db) => {
      const b = await base(db);
      await db.fails(
        "insert into public.ai_usage (project_id, task, provider, model, status) values ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'success')",
        [b.project],
        /permission denied/,
      );
      await db.asAdmin();
      await db.q(
        `insert into public.ai_usage (project_id, task, provider, model, status, input_tokens, output_tokens, cost_usd) values
         ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'success', 1000, 200, 0.0002),
         ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'error', 0, 0, null),
         ($1, 'script', 'anthropic', 'claude-sonnet-5-5', 'success', 5000, 1500, 0.025)`,
        [b.project],
      );
      await db.as(b.user);
      const rows = await db.q<{ task: string; calls: string; errors: string; cost_usd: string }>(
        "select task, calls, errors, cost_usd from public.ai_usage_summary($1, 30)",
        [b.project],
      );
      expect(rows.map((r) => [r.task, Number(r.calls), Number(r.errors), Number(r.cost_usd)])).toEqual([
        ["scoring", 2, 1, 0.0002],
        ["script", 1, 0, 0.025],
      ]);
    }));
});
