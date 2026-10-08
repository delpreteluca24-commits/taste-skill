import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

async function asset(db: Db) {
  const user = await db.createUser();
  const project = await createProject(db, user);
  await db.as(user);
  const video = await db.one<{ id: string }>(
    "insert into public.videos (project_id, title, storage_path) values ($1, 'Match footage', $2) returning id",
    [project, `${project}/match.mp4`],
  );
  const story = await db.one<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'Story') returning id", [project]);
  const content = await db.one<{ id: string }>(
    "insert into public.content_items (project_id, story_id, title) values ($1, $2, 'Short') returning id",
    [project, story.id],
  );
  const clip = await db.one<{ id: string }>(
    "insert into public.clips (project_id, video_id, content_item_id, start_sec, end_sec) values ($1, $2, $3, 0, 30) returning id",
    [project, video.id, content.id],
  );
  return { user, project, video: video.id, story: story.id, content: content.id, clip: clip.id };
}

const videoState = (db: Db, id: string) =>
  db.one<{ rights_status: string; usable_in_production: boolean; rights_check_id: string | null }>(
    "select rights_status, usable_in_production, rights_check_id from public.videos where id = $1",
    [id],
  );

describe("rights classification (DB rules)", () => {
  it("stores the full rights-first classification on a check", () =>
    tx(async (db) => {
      const a = await asset(db);
      const rc = await db.one<Record<string, unknown>>(
        `insert into public.rights_checks (project_id, video_id, owner, ownership, source_detail, license, commercial_use,
           authorization_details, transformation_required, risk, evidence_url, notes, status)
         values ($1, $2, 'Club FC', 'authorized', 'Club media office', 'Editorial + social', true,
           'Email from press office 2026-10-01', true, 'low', 'https://example.test/permission.pdf', 'Only with commentary', 'green')
         returning *`,
        [a.project, a.video],
      );
      expect(rc).toMatchObject({
        ownership: "authorized",
        source_detail: "Club media office",
        commercial_use: true,
        transformation_required: true,
        evidence_url: "https://example.test/permission.pdf",
        status: "green",
        checked_by: a.user,
      });
      expect(await videoState(db, a.video)).toMatchObject({ rights_status: "green", usable_in_production: true, rights_check_id: rc.id });
    }));

  it.each([
    ["commercial use unknown", "'licensed', null, 'https://example.test/l.pdf'"],
    ["no evidence for licensed material", "'licensed', true, null"],
    ["third-party ownership", "'third_party', true, 'https://example.test/l.pdf'"],
    ["unknown ownership", "'unknown', true, 'https://example.test/l.pdf'"],
  ])("refuses GREEN without a documented basis (%s)", (_label, values) =>
    tx(async (db) => {
      const a = await asset(db);
      await db.fails(
        `insert into public.rights_checks (project_id, video_id, ownership, commercial_use, evidence_url, status) values ($1, $2, ${values}, 'green')`,
        [a.project, a.video],
        /rights_checks_green_requires_basis/,
      );
    }));

  it("accepts GREEN for owned material without an evidence link", () =>
    tx(async (db) => {
      const a = await asset(db);
      await db.q("insert into public.rights_checks (project_id, video_id, ownership, commercial_use, status) values ($1, $2, 'owned', true, 'green')", [
        a.project,
        a.video,
      ]);
      expect((await videoState(db, a.video)).rights_status).toBe("green");
    }));

  it("keeps derived rights columns read-only for everyone", () =>
    tx(async (db) => {
      const a = await asset(db);
      await db.fails("update public.videos set usable_in_production = true where id = $1", [a.video], /RIGHTS_BLOCKED/);
      await db.asAdmin();
      await db.fails("update public.videos set usable_in_production = true where id = $1", [a.video], /RIGHTS_BLOCKED/);
    }));
});

describe("rights gate — GREEN / YELLOW (+approval) / RED", () => {
  it("YELLOW is unusable until a human approves it, and never usable by automated workers", () =>
    tx(async (db) => {
      const a = await asset(db);
      const check = await db.one<{ id: string }>(
        "insert into public.rights_checks (project_id, video_id, ownership, commercial_use, status, notes) values ($1, $2, 'creator_provided', null, 'yellow', 'awaiting written permission') returning id",
        [a.project, a.video],
      );
      expect(await videoState(db, a.video)).toMatchObject({ rights_status: "yellow", usable_in_production: false });
      await db.fails("update public.clips set status = 'approved' where id = $1", [a.clip], /YELLOW only after a rights approval/);

      // human approval (RIGHTS → APPROVAL when YELLOW)
      await db.q("select public.record_approval('rights', $1, 'approved', 'creator confirmed by DM, screenshot archived')", [check.id]);
      expect(await videoState(db, a.video)).toMatchObject({ rights_status: "yellow", usable_in_production: true });
      await db.q("update public.clips set status = 'approved' where id = $1", [a.clip]);

      // automated workflow (worker = no auth.uid()) may NOT use YELLOW, even approved
      await db.asAdmin();
      await db.fails("update public.clips set status = 'rendering' where id = $1", [a.clip], /automated production requires GREEN/);
    }));

  it("a later rejection revokes YELLOW usability", () =>
    tx(async (db) => {
      const a = await asset(db);
      const check = await db.one<{ id: string }>(
        "insert into public.rights_checks (project_id, video_id, ownership, status) values ($1, $2, 'unknown', 'yellow') returning id",
        [a.project, a.video],
      );
      await db.q("select public.record_approval('rights', $1, 'approved', null)", [check.id]);
      await db.q("select public.record_approval('rights', $1, 'rejected', 'permission withdrawn')", [check.id]);
      expect((await videoState(db, a.video)).usable_in_production).toBe(false);
    }));

  it("RED can never be approved for use", () =>
    tx(async (db) => {
      const a = await asset(db);
      const check = await db.one<{ id: string }>(
        "insert into public.rights_checks (project_id, video_id, ownership, status, risk) values ($1, $2, 'third_party', 'red', 'league broadcast footage') returning id",
        [a.project, a.video],
      );
      await db.fails("select public.record_approval('rights', $1, 'approved', null)", [check.id], /RIGHTS_APPROVAL_INVALID/);
      await db.fails("update public.clips set status = 'approved' where id = $1", [a.clip], /RIGHTS_BLOCKED/);
    }));

  it("only the latest classification can be approved", () =>
    tx(async (db) => {
      const a = await asset(db);
      const old = await db.one<{ id: string }>(
        "insert into public.rights_checks (project_id, video_id, ownership, status) values ($1, $2, 'unknown', 'yellow') returning id",
        [a.project, a.video],
      );
      await db.q("insert into public.rights_checks (project_id, video_id, ownership, status) values ($1, $2, 'unknown', 'yellow')", [
        a.project,
        a.video,
      ]);
      await db.fails("select public.record_approval('rights', $1, 'approved', null)", [old.id], /newer classification/);
    }));

  it("automated workers can use GREEN footage", () =>
    tx(async (db) => {
      const a = await asset(db);
      await db.q("insert into public.rights_checks (project_id, video_id, ownership, commercial_use, status) values ($1, $2, 'owned', true, 'green')", [
        a.project,
        a.video,
      ]);
      await db.asAdmin();
      await db.q("update public.clips set status = 'rendering' where id = $1", [a.clip]);
    }));

  it("lists every asset with its classification in the Rights Center view (project-isolated)", () =>
    tx(async (db) => {
      const a = await asset(db);
      await db.q(
        "insert into public.sources (project_id, name, url) values ($1, 'Agency', 'https://example.test/a'), ($1, 'Club', 'https://example.test/b')",
        [a.project],
      );
      const rows = await db.q<{ asset_type: string; rights_status: string; awaiting_approval: boolean }>(
        "select asset_type, rights_status, awaiting_approval from public.asset_rights where project_id = $1 order by asset_type",
        [a.project],
      );
      expect(rows.map((r) => r.asset_type)).toEqual(["source", "source", "video"]);
      const other = await db.createUser();
      await db.as(other);
      expect(await db.q("select 1 from public.asset_rights where project_id = $1", [a.project])).toHaveLength(0);
    }));
});

describe("STORY ≠ FOOTAGE", () => {
  it("a story can be approved while every footage asset is RED", () =>
    tx(async (db) => {
      const a = await asset(db);
      await db.q("insert into public.rights_checks (project_id, video_id, ownership, status) values ($1, $2, 'third_party', 'red')", [
        a.project,
        a.video,
      ]);
      await db.q("select public.record_approval('story', $1, 'approved', 'tell it with commentary + stats')", [a.story]);
      expect((await db.one<{ status: string }>("select status from public.stories where id = $1", [a.story])).status).toBe("approved");
      await db.q("update public.stories set production_formats = '{original_commentary,statistics,timeline}' where id = $1", [a.story]);
    }));
});
