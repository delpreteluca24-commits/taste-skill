import { randomUUID } from "node:crypto";

import pg from "pg";

/**
 * Integration-test harness for the real Supabase Postgres.
 * Each test runs inside ONE transaction that is rolled back at the end, so tests
 * leave no data behind. Inside it we impersonate users exactly like PostgREST
 * does: `set local role authenticated` + `request.jwt.claims`.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 4,
});

export type Db = {
  q: <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  one: <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T>;
  /** Run statements as this authenticated user (RLS applies). */
  as: (userId: string) => Promise<void>;
  /** Run as the anonymous API role. */
  asAnon: () => Promise<void>;
  /** Back to the postgres superuser (bypasses RLS) for fixtures/assertions. */
  asAdmin: () => Promise<void>;
  /** Expect the statement to fail; the transaction stays usable (savepoint). */
  fails: (sql: string, params: unknown[] | undefined, match: RegExp) => Promise<void>;
  createUser: (opts?: { role?: "member" | "admin" | "owner" }) => Promise<string>;
};

export async function tx(fn: (db: Db) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  await client.query("begin");

  const q: Db["q"] = async (sql, params) => (await client.query(sql, params as unknown[])).rows;
  const one: Db["one"] = async (sql, params) => {
    const rows = await q(sql, params);
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
    return rows[0] as never;
  };

  const db: Db = {
    q,
    one,
    async as(userId) {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    },
    async asAnon() {
      await client.query("reset role");
      await client.query("set local role anon");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    },
    async asAdmin() {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', '', true)");
    },
    async fails(sql, params, match) {
      await client.query("savepoint expect_fail");
      let error: unknown = null;
      try {
        await client.query(sql, params as unknown[]);
      } catch (e) {
        error = e;
      }
      await client.query("rollback to savepoint expect_fail");
      if (!error) throw new Error(`expected failure ${match} but statement succeeded: ${sql}`);
      const message = `${(error as { code?: string }).code ?? ""} ${(error as Error).message}`;
      if (!match.test(message)) throw new Error(`expected ${match}, got: ${message}`);
    },
    async createUser(opts) {
      const id = randomUUID();
      await client.query("reset role");
      await client.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                                 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(),
                 '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [id, `test-${id}@example.test`],
      );
      if (opts?.role) await client.query("update public.users set role = $2 where id = $1", [id, opts.role]);
      return id;
    },
  };

  try {
    await fn(db);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/** Fixture: a project owned by `ownerId`, created through RLS like the app does. */
export async function createProject(db: Db, ownerId: string, name = "Test Project"): Promise<string> {
  await db.as(ownerId);
  const row = await db.one<{ id: string }>(
    "insert into public.projects (owner_id, name, slug) values ($1, $2, $3) returning id",
    [ownerId, name, `p-${randomUUID().slice(0, 8)}`],
  );
  return row.id;
}
