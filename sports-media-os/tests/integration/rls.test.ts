import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx } from "./db";

afterAll(() => pool.end());

describe("identity", () => {
  it("mirrors auth.users into public.users and blocks role self-escalation", () =>
    tx(async (db) => {
      const u = await db.createUser({ role: "member" });
      await db.as(u);
      const me = await db.one<{ role: string }>("select role from public.users where id = $1", [u]);
      expect(me.role).toBe("member");

      await db.fails("update public.users set role = 'owner' where id = $1", [u], /permission denied/);
      await db.q("update public.users set display_name = 'Me' where id = $1", [u]);
      expect((await db.one<{ display_name: string }>("select display_name from public.users where id = $1", [u])).display_name).toBe("Me");
    }));

  it("gives the anon role no access to any table", () =>
    tx(async (db) => {
      await db.asAnon();
      await db.fails("select 1 from public.projects", [], /permission denied/);
      await db.fails("select 1 from public.sports", [], /permission denied/);
      await db.fails("select public.get_dashboard(gen_random_uuid())", [], /permission denied/);
    }));
});

describe("project isolation", () => {
  it("auto-creates the owner membership and isolates projects between users", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      const bob = await db.createUser();
      const project = await createProject(db, alice);

      await db.as(alice);
      const membership = await db.one<{ role: string }>(
        "select role from public.project_members where project_id = $1 and user_id = $2",
        [project, alice],
      );
      expect(membership.role).toBe("owner");
      await db.q("insert into public.opportunities (project_id, title) values ($1, 'Derby comeback')", [project]);

      await db.as(bob);
      expect(await db.q("select id from public.projects where id = $1", [project])).toHaveLength(0);
      expect(await db.q("select id from public.opportunities where project_id = $1", [project])).toHaveLength(0);
      await db.fails(
        "insert into public.opportunities (project_id, title) values ($1, 'intrusion')",
        [project],
        /row-level security/,
      );
      // Bob cannot make himself a member either
      await db.fails(
        "insert into public.project_members (project_id, user_id, role) values ($1, $2, 'owner')",
        [project, bob],
        /row-level security/,
      );
      await db.fails("select public.get_dashboard($1)", [project], /NOT_FOUND/);
    }));

  it("enforces role levels: viewer reads, editor writes, admin deletes", () =>
    tx(async (db) => {
      const owner = await db.createUser();
      const viewer = await db.createUser();
      const editor = await db.createUser();
      const project = await createProject(db, owner);
      await db.as(owner);
      await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'editor')", [
        project,
        viewer,
        editor,
      ]);
      const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'x') returning id", [project]);

      await db.as(viewer);
      expect(await db.q("select id from public.opportunities where project_id = $1", [project])).toHaveLength(1);
      await db.fails("insert into public.opportunities (project_id, title) values ($1, 'y')", [project], /row-level security/);

      await db.as(editor);
      await db.q("update public.opportunities set title = 'edited' where id = $1", [opp.id]);
      const deleted = await db.q("delete from public.opportunities where id = $1 returning id", [opp.id]);
      expect(deleted).toHaveLength(0); // editors cannot delete (RLS filters silently)

      await db.as(owner);
      expect(await db.q("delete from public.opportunities where id = $1 returning id", [opp.id])).toHaveLength(1);
    }));

  it("rejects links to rows of another project (composite foreign keys)", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      const p1 = await createProject(db, alice, "P1");
      const p2 = await createProject(db, alice, "P2");
      await db.as(alice);
      const opp = await db.one<{ id: string }>("insert into public.opportunities (project_id, title) values ($1, 'o') returning id", [p2]);
      await db.fails(
        "insert into public.content_items (project_id, opportunity_id, title) values ($1, $2, 'cross-project')",
        [p1, opp.id],
        /foreign key/,
      );
    }));

  it("validates project timezones in the database", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      await db.as(alice);
      await db.fails(
        "insert into public.projects (owner_id, name, slug, timezone) values ($1, 'x', 'x', 'Mars/Base')",
        [alice],
        /check constraint/,
      );
    }));
});

describe("settings and append-only tables", () => {
  it("only app admins write workspace settings; project settings need project admin", () =>
    tx(async (db) => {
      const member = await db.createUser({ role: "member" });
      const admin = await db.createUser({ role: "admin" });

      await db.as(member);
      await db.fails(
        "insert into public.settings (key, value) values ('ai', '{\"provider\":\"openai\"}')",
        [],
        /row-level security/,
      );
      const project = await createProject(db, member);
      await db.as(member);
      await db.q("insert into public.settings (project_id, key, value) values ($1, 'thresholds', '{}')", [project]);

      await db.as(admin);
      await db.q("delete from public.settings where project_id is null and key = 'test.key'");
      await db.q("insert into public.settings (key, value) values ('test.key', '1')");
      await db.fails("insert into public.settings (key, value) values ('test.key', '2')", [], /duplicate key/);
    }));

  it("keeps activity logs and approvals append-only", () =>
    tx(async (db) => {
      const u = await db.createUser();
      const project = await createProject(db, u);
      await db.as(u);
      const log = await db.one<{ id: string }>(
        "insert into public.activity_logs (project_id, actor_type, actor_id, action) values ($1, 'user', $2, 'test') returning id",
        [project, u],
      );
      await db.fails("update public.activity_logs set action = 'tampered' where id = $1", [log.id], /permission denied/);
      await db.fails("delete from public.activity_logs where id = $1", [log.id], /permission denied/);
      // cannot forge another actor
      await db.fails(
        "insert into public.activity_logs (project_id, actor_type, actor_id, action) values ($1, 'agent', null, 'forged')",
        [project],
        /row-level security|check constraint/,
      );
    }));
});
