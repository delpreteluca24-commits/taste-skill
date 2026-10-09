import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

async function setup(db: Db) {
  const user = await db.createUser();
  const project = await createProject(db, user);
  await db.as(user);
  const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'Opp') returning id", [project]);
  const story = await db.one<{ id: string }>(
    "insert into public.stories (project_id, opportunity_id, title) values ($1, $2, 'Story') returning id",
    [project, opp.id],
  );
  const content = await db.one<{ id: string }>(
    "insert into public.content_items (project_id, opportunity_id, story_id, title) values ($1, $2, $3, 'Short') returning id",
    [project, opp.id, story.id],
  );
  // production needs an APPROVED current script (human checkpoint)
  const script = await db.one<{ id: string }>(
    "insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'Hook', true) returning id",
    [project, story.id],
  );
  await db.q("select public.record_approval('script', $1, 'approved', 'ok')", [script.id]);
  const source = await db.one<{ id: string }>(
    "insert into public.sources (project_id, name, url) values ($1, 'Agency', $2) returning id",
    [project, `https://example.test/${project}`],
  );
  return { user, project, opp: opp.id, story: story.id, content: content.id, script: script.id, source: source.id };
}

describe("fact-check READY gate", () => {
  it("blocks READY while a critical fact is not confirmed, then allows it", () =>
    tx(async (db) => {
      const s = await setup(db);
      const fact = await db.one<{ id: string }>(
        "insert into public.facts (project_id, opportunity_id, claim, status, is_critical) values ($1, $2, 'Scored 40 goals', 'probable', true) returning id",
        [s.project, s.opp],
      );

      await db.fails("update public.content_items set stage = 'ready' where id = $1", [s.content], /CONTENT_NOT_READY: 1 critical fact/);
      expect(await db.one("select public.content_item_blockers($1) as b", [s.content])).toEqual({
        b: ["1 critical fact(s) not confirmed"],
      });

      // non-critical unverified facts do not block
      await db.q("insert into public.facts (project_id, story_id, claim, status, is_critical) values ($1, $2, 'Color of boots', 'uncertain', false)", [
        s.project,
        s.story,
      ]);
      await db.q("insert into public.fact_sources (project_id, fact_id, source_id) values ($1, $2, $3)", [s.project, fact.id, s.source]);
      await db.q("update public.facts set status = 'confirmed' where id = $1", [fact.id]);
      await db.q("update public.content_items set stage = 'ready' where id = $1", [s.content]);

      const published = await db.one<{ published_at: Date | null; stage_changed_at: Date }>(
        "update public.content_items set stage = 'published' where id = $1 returning published_at, stage_changed_at",
        [s.content],
      );
      expect(published.published_at).not.toBeNull();
    }));

  it("blocks a content item inserted directly as READY with unverified critical facts", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.q("insert into public.facts (project_id, story_id, claim, status) values ($1, $2, 'claim', 'false')", [s.project, s.story]);
      await db.fails(
        "insert into public.content_items (project_id, story_id, title, stage) values ($1, $2, 'direct', 'ready')",
        [s.project, s.story],
        /CONTENT_NOT_READY/,
      );
    }));
});

describe("rights gate", () => {
  it("keeps RED / unchecked material out of production and READY", () =>
    tx(async (db) => {
      const s = await setup(db);
      const video = await db.one<{ id: string; rights_status: string }>(
        "insert into public.videos (project_id, title, storage_path) values ($1, 'Match', $2) returning id, rights_status",
        [s.project, `${s.project}/match.mp4`],
      );
      expect(video.rights_status).toBe("unchecked");
      const clip = await db.one<{ id: string }>(
        "insert into public.clips (project_id, video_id, content_item_id, start_sec, end_sec) values ($1, $2, $3, 10, 40) returning id",
        [s.project, video.id, s.content],
      );

      await db.fails("update public.clips set status = 'approved' where id = $1", [clip.id], /RIGHTS_BLOCKED: .*unchecked/);
      await db.fails("update public.content_items set stage = 'ready' where id = $1", [s.content], /not cleared for production/);

      // a GREEN check unlocks production…
      await db.q(
        "insert into public.rights_checks (project_id, video_id, owner, ownership, license, commercial_use, evidence_url, status) values ($1, $2, 'Club', 'licensed', 'Licensed', true, 'https://example.test/license.pdf', 'green')",
        [s.project, video.id],
      );
      expect((await db.one<{ rights_status: string }>("select rights_status from public.videos where id = $1", [video.id])).rights_status).toBe("green");
      await db.q("update public.clips set status = 'approved' where id = $1", [clip.id]);
      await db.q("update public.content_items set stage = 'ready' where id = $1", [s.content]);

      // …and a newer RED check blocks it again
      await db.q("insert into public.rights_checks (project_id, video_id, status, risk) values ($1, $2, 'red', 'takedown notice')", [s.project, video.id]);
      expect((await db.one<{ rights_status: string }>("select rights_status from public.videos where id = $1", [video.id])).rights_status).toBe("red");
      await db.fails("update public.clips set status = 'rendering' where id = $1", [clip.id], /RIGHTS_BLOCKED: .*red/);

      // deleting the RED check restores the previous status
      await db.q("delete from public.rights_checks where video_id = $1 and status = 'red'", [video.id]);
      expect((await db.one<{ rights_status: string }>("select rights_status from public.videos where id = $1", [video.id])).rights_status).toBe("green");
    }));

  it("derives rights status from rights checks only (no direct writes)", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.fails(
        "insert into public.videos (project_id, title, storage_path, rights_status) values ($1, 'v', $2, 'green')",
        [s.project, `${s.project}/v.mp4`],
        /RIGHTS_BLOCKED: rights status starts as unchecked/,
      );
      const video = await db.one<{ id: string }>(
        "insert into public.videos (project_id, title, storage_path) values ($1, 'v', $2) returning id",
        [s.project, `${s.project}/v.mp4`],
      );
      await db.fails("update public.videos set rights_status = 'green' where id = $1", [video.id], /RIGHTS_BLOCKED: .*only through a rights check/);
      // other columns stay editable
      await db.q("update public.videos set title = 'renamed' where id = $1", [video.id]);
      // the service role is bound by the same rule
      await db.asAdmin();
      await db.fails("update public.videos set rights_status = 'green' where id = $1", [video.id], /RIGHTS_BLOCKED/);
    }));

  it("refuses API publishing before the READY gate", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.fails(
        "insert into public.publishing_jobs (project_id, content_item_id, platform, mode) values ($1, $2, 'youtube', 'api')",
        [s.project, s.content],
        /PUBLISH_BLOCKED/,
      );
      // manual export packages are always allowed
      await db.q("insert into public.publishing_jobs (project_id, content_item_id, platform, mode) values ($1, $2, 'youtube', 'manual_export')", [
        s.project,
        s.content,
      ]);
    }));
});

describe("script versions", () => {
  it("numbers versions, keeps one current, and never overwrites", () =>
    tx(async (db) => {
      const s = await setup(db);
      const v1 = await db.one<{ id: string; version: number }>(
        "insert into public.scripts (project_id, story_id, hook, is_current, operation) values ($1, $2, 'Hook v1', true, 'generate') returning id, version",
        [s.project, s.story],
      );
      const v2 = await db.one<{ id: string; version: number }>(
        "insert into public.scripts (project_id, story_id, hook, is_current, operation, parent_script_id) values ($1, $2, 'Hook v2', true, 'rewrite_hook', $3) returning id, version",
        [s.project, s.story, v1.id],
      );
      // setup() already created version 1 → these are 2 and 3
      expect([v1.version, v2.version]).toEqual([2, 3]);
      const current = await db.q<{ id: string }>("select id from public.scripts where story_id = $1 and is_current", [s.story]);
      expect(current.map((r) => r.id)).toEqual([v2.id]);

      await db.fails("update public.scripts set hook = 'overwrite' where id = $1", [v1.id], /SCRIPT_IMMUTABLE/);
      await db.fails("delete from public.scripts where id = $1", [v1.id], /permission denied/);

      // reverting = switching the current pointer, not editing
      await db.q("update public.scripts set is_current = true where id = $1", [v1.id]);
      const after = await db.q<{ id: string }>("select id from public.scripts where story_id = $1 and is_current", [s.story]);
      expect(after.map((r) => r.id)).toEqual([v1.id]);
    }));

  it("lets a story be deleted even when another story's script descends from it", () =>
    tx(async (db) => {
      const a = await setup(db);
      const other = await db.one<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'Other') returning id", [a.project]);
      const parent = await db.one<{ id: string }>(
        "insert into public.scripts (project_id, story_id, hook, is_current) values ($1, $2, 'p', true) returning id",
        [a.project, a.story],
      );
      const child = await db.one<{ id: string }>(
        "insert into public.scripts (project_id, story_id, hook, is_current, parent_script_id) values ($1, $2, 'c', true, $3) returning id",
        [a.project, other.id, parent.id],
      );
      await db.fails("update public.scripts set parent_script_id = $2 where id = $1", [parent.id, child.id], /SCRIPT_IMMUTABLE/);
      await db.q("delete from public.stories where id = $1", [a.story]);
      const after = await db.one<{ parent_script_id: string | null }>("select parent_script_id from public.scripts where id = $1", [child.id]);
      expect(after.parent_script_id).toBeNull();
    }));

  it("keeps a single selected title per content item", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.q("insert into public.titles (project_id, content_item_id, text, is_selected) values ($1, $2, 'A', true)", [s.project, s.content]);
      await db.q("insert into public.titles (project_id, content_item_id, text, is_selected) values ($1, $2, 'B', true)", [s.project, s.content]);
      const selected = await db.q<{ text: string }>("select text from public.titles where content_item_id = $1 and is_selected", [s.content]);
      expect(selected.map((r) => r.text)).toEqual(["B"]);
    }));
});

describe("audit stamps", () => {
  it("stamps who checked a fact or a rights item from the session, not the payload", () =>
    tx(async (db) => {
      const s = await setup(db);
      const someoneElse = await db.createUser();
      await db.as(s.user);
      const fact = await db.one<{ id: string; checked_by: string; checked_at: Date }>(
        "insert into public.facts (project_id, opportunity_id, claim, status, checked_by) values ($1, $2, 'c', 'probable', $3) returning id, checked_by, checked_at",
        [s.project, s.opp, someoneElse],
      );
      expect(fact.checked_by).toBe(s.user);
      expect(fact.checked_at).not.toBeNull();

      // audit fields cannot be rewritten without a verification change
      await db.q("update public.facts set checked_by = $2, notes = 'n' where id = $1", [fact.id, someoneElse]);
      expect((await db.one<{ checked_by: string }>("select checked_by from public.facts where id = $1", [fact.id])).checked_by).toBe(s.user);

      const video = await db.one<{ id: string }>("insert into public.videos (project_id, title, storage_path) values ($1, 'v', $2) returning id", [
        s.project,
        `${s.project}/v.mp4`,
      ]);
      const check = await db.one<{ checked_by: string; checked_by_agent: string | null }>(
        "insert into public.rights_checks (project_id, video_id, status, checked_by, checked_by_agent) values ($1, $2, 'yellow', $3, 'rights') returning checked_by, checked_by_agent",
        [s.project, video.id, someoneElse],
      );
      expect(check).toEqual({ checked_by: s.user, checked_by_agent: null });
    }));
});

describe("dashboard RPC", () => {
  it("returns every control-room section from real data only", () =>
    tx(async (db) => {
      const s = await setup(db);
      await db.q("update public.opportunities set opportunity_score = 87.5 where id = $1", [s.opp]);
      await db.q("update public.content_items set stage = 'production' where id = $1", [s.content]);
      const { d } = await db.one<{ d: Record<string, unknown> }>("select public.get_dashboard($1) as d", [s.project]);

      expect(Object.keys(d).sort()).toEqual(
        [
          "agent_status",
          "content_in_production",
          "generated_at",
          "metrics",
          "performing_content",
          "pipeline",
          "published",
          "ready_to_publish",
          "recent_performance",
          "timezone",
          "todays_opportunities",
          "top_opportunities",
          "trending_stories",
        ].sort(),
      );
      const metrics = d.metrics as Record<string, unknown>;
      expect(Number(metrics.top_opportunity_score)).toBe(87.5);
      expect(metrics.production_queue).toBe(1);
      expect(metrics.avg_virality_score).toBeNull();
      expect(d.pipeline).toEqual({ production: 1 });
      expect(d.recent_performance).toHaveLength(14);
      expect(d.todays_opportunities).toHaveLength(1);
    }));
});
