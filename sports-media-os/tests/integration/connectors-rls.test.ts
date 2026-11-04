import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx } from "./db";

afterAll(() => pool.end());

const insertConnector = `
  insert into public.connectors (project_id, name, kind, url, target, created_by)
  values ($1, $2, 'rss', $3, 'sources', $4) returning id`;

describe("connectors RLS", () => {
  it("isolates connectors between projects", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      const bob = await db.createUser();
      const projectA = await createProject(db, alice, "A");
      const projectB = await createProject(db, bob, "B");

      await db.as(alice);
      const { id } = await db.one<{ id: string }>(insertConnector, [projectA, "Feed A", "https://a.example.com/rss", alice]);

      await db.as(bob);
      expect(await db.q("select id from public.connectors where id = $1", [id])).toHaveLength(0);
      expect(await db.q("select id from public.connectors where project_id = $1", [projectA])).toHaveLength(0);
      // writes into another project are refused; updates/deletes silently match nothing
      await db.fails(insertConnector, [projectA, "Intrusion", "https://evil.example.com/rss", bob], /row-level security/);
      expect(await db.q("update public.connectors set url = 'https://evil.example.com/rss' where id = $1 returning id", [id])).toHaveLength(0);
      expect(await db.q("delete from public.connectors where id = $1 returning id", [id])).toHaveLength(0);
      // cannot move a connector of their own project into project A either
      const { id: own } = await db.one<{ id: string }>(insertConnector, [projectB, "Feed B", "https://b.example.com/rss", bob]);
      await db.fails("update public.connectors set project_id = $1 where id = $2", [projectA, own], /row-level security/);

      await db.as(alice);
      const row = await db.one<{ url: string }>("select url from public.connectors where id = $1", [id]);
      expect(row.url).toBe("https://a.example.com/rss");
      expect(await db.q("select id from public.connectors where id = $1", [own])).toHaveLength(0);
    }));

  it("viewers read, editors write", () =>
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
      const { id } = await db.one<{ id: string }>(insertConnector, [project, "Feed", "https://feed.example.com/rss", owner]);

      await db.as(viewer);
      expect(await db.q("select id from public.connectors where project_id = $1", [project])).toHaveLength(1);
      await db.fails(insertConnector, [project, "Viewer feed", "https://v.example.com/rss", viewer], /row-level security/);
      expect(await db.q("update public.connectors set enabled = false where id = $1 returning id", [id])).toHaveLength(0);
      expect(await db.q("delete from public.connectors where id = $1 returning id", [id])).toHaveLength(0);

      await db.as(editor);
      expect(await db.q("update public.connectors set enabled = false where id = $1 returning id", [id])).toHaveLength(1);
      expect(await db.q("delete from public.connectors where id = $1 returning id", [id])).toHaveLength(1);
    }));

  it("enforces URL, interval and status constraints and one connector per URL per project", () =>
    tx(async (db) => {
      const owner = await db.createUser();
      const project = await createProject(db, owner);
      const other = await createProject(db, owner, "Other");
      await db.as(owner);
      await db.one(insertConnector, [project, "Feed", "https://feed.example.com/rss", owner]);
      await db.fails(insertConnector, [project, "Same URL", "https://feed.example.com/rss", owner], /23505/);
      // the same feed may be watched by another project
      await db.one(insertConnector, [other, "Feed", "https://feed.example.com/rss", owner]);
      await db.fails(insertConnector, [project, "Bad scheme", "file:///etc/passwd", owner], /23514|check/);
      await db.fails(
        "insert into public.connectors (project_id, name, kind, url, fetch_interval_minutes) values ($1, 'x', 'rss', 'https://x.example.com', 5)",
        [project],
        /23514|check/,
      );
      await db.fails(
        "update public.connectors set last_status = 'exploded' where project_id = $1",
        [project],
        /23514|check/,
      );
    }));

  it("links sources/events to a connector of the SAME project only", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      const projectA = await createProject(db, alice, "A");
      const projectB = await createProject(db, alice, "B");
      await db.as(alice);
      const { id: connectorA } = await db.one<{ id: string }>(insertConnector, [projectA, "Feed", "https://a.example.com/rss", alice]);

      await db.q("insert into public.sources (project_id, name, url, connector_id) values ($1, 'Feed', 'https://a.example.com/1', $2)", [
        projectA,
        connectorA,
      ]);
      await db.fails(
        "insert into public.sources (project_id, name, url, connector_id) values ($1, 'Feed', 'https://a.example.com/2', $2)",
        [projectB, connectorA],
        /23503|foreign key/,
      );
      await db.fails(
        "insert into public.events (project_id, title, connector_id) values ($1, 'Match', $2)",
        [projectB, connectorA],
        /23503|foreign key/,
      );

      // deleting the connector keeps what it collected (connector_id cleared)
      await db.q("delete from public.connectors where id = $1", [connectorA]);
      const kept = await db.one<{ connector_id: string | null }>("select connector_id from public.sources where url = 'https://a.example.com/1'");
      expect(kept.connector_id).toBeNull();
    }));
});
