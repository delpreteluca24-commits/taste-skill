import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineHandler } from "@/workers/context";
import { runJob, type HandlerMap } from "@/workers/runner";
import type { Database } from "@/types/database";

import { pool } from "./db";

/**
 * The worker uses the service role (bypasses RLS). These tests prove a job can
 * only touch entities of ITS project, whatever ids the (user-supplied) payload holds.
 */
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ids = { users: [] as string[], projects: [] as string[] };
let projectA = "";
let projectB = "";
let storyA = "";
let storyB = "";

async function user() {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{}', '{}', now(), now())`,
    [id, `worker-${id}@example.test`],
  );
  ids.users.push(id);
  return id;
}

async function project(owner: string) {
  const { rows } = await pool.query<{ id: string }>(
    "insert into public.projects (owner_id, name, slug) values ($1, 'W', $2) returning id",
    [owner, `w-${randomUUID().slice(0, 8)}`],
  );
  ids.projects.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  projectA = await project(await user());
  projectB = await project(await user());
  storyA = (await pool.query<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'A') returning id", [projectA])).rows[0].id;
  storyB = (await pool.query<{ id: string }>("insert into public.stories (project_id, title) values ($1, 'B') returning id", [projectB])).rows[0].id;
});

afterAll(async () => {
  await pool.query("delete from public.jobs where project_id = any($1)", [ids.projects]);
  await pool.query("delete from public.projects where id = any($1)", [ids.projects]);
  await pool.query("delete from auth.users where id = any($1)", [ids.users]);
  await pool.end();
});

/** a job already claimed by a worker (status running) */
async function runningJob(projectId: string, type: string, payload: unknown) {
  const { rows } = await pool.query(
    `insert into public.jobs (project_id, type, payload, status, attempts, locked_at, locked_by, started_at)
     values ($1, $2, $3, 'running', 1, now(), 'test', now()) returning *`,
    [projectId, type, JSON.stringify(payload)],
  );
  return rows[0];
}

const jobState = async (id: string) =>
  (await pool.query<{ status: string; error_message: string | null; result: unknown }>("select status, error_message, result from public.jobs where id = $1", [id]))
    .rows[0];

const handlers: HandlerMap = {
  "script.generate": defineHandler({
    type: "script.generate",
    async run(ctx, payload) {
      const story = await ctx.loadOwned("stories", payload.storyId);
      return ctx.withAgentRun("story", { storyId: story.id }, async () => ({
        result: { title: story.title, angles: payload.angles },
        output: { ok: true },
      }));
    },
  }),
};

describe("worker job isolation", () => {
  it("runs a job against entities of its own project and records the agent run", async () => {
    const job = await runningJob(projectA, "script.generate", { storyId: storyA, angles: ["analysis"] });
    expect(await runJob(admin, handlers, job)).toBe("completed");
    expect(await jobState(job.id)).toMatchObject({ status: "completed", result: { title: "A", angles: ["analysis"] } });
    const runs = await pool.query("select agent, status from public.agent_runs where project_id = $1", [projectA]);
    expect(runs.rows).toEqual([{ agent: "story", status: "completed" }]);
  });

  it("refuses a payload that points to another project's entity — without retrying", async () => {
    const job = await runningJob(projectA, "script.generate", { storyId: storyB, angles: ["analysis"] });
    expect(await runJob(admin, handlers, job)).toBe("failed");
    const state = await jobState(job.id);
    expect(state.status).toBe("failed"); // permanent: not re-queued
    expect(state.error_message).toMatch(/not found in this project/);
  });

  it("fails invalid payloads and unknown job types permanently", async () => {
    const bad = await runningJob(projectA, "script.generate", { storyId: "not-a-uuid", angles: [] });
    expect(await runJob(admin, handlers, bad)).toBe("failed");
    expect((await jobState(bad.id)).error_message).toMatch(/invalid payload/);

    const unhandled = await runningJob(projectA, "hooks.generate", { storyId: storyA });
    expect(await runJob(admin, handlers, unhandled)).toBe("failed");
    expect((await jobState(unhandled.id)).error_message).toMatch(/no handler registered/);
  });

  it("re-queues transient failures with backoff", async () => {
    const flaky: HandlerMap = {
      "script.generate": defineHandler({
        type: "script.generate",
        async run() {
          throw new Error("upstream timeout");
        },
      }),
    };
    const job = await runningJob(projectA, "script.generate", { storyId: storyA, angles: ["analysis"] });
    expect(await runJob(admin, flaky, job)).toBe("failed");
    expect((await jobState(job.id)).status).toBe("pending");
  });
});
