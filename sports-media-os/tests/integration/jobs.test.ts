import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createProject, pool, tx } from "./db";

afterAll(() => pool.end());

/** Job types allow only [a-z_] segments: random lowercase-letter suffix keeps tests isolated. */
const suffix = () => Array.from(randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join("");

describe("job queue — client side", () => {
  it("lets editors enqueue pending jobs only, and never claim them", () =>
    tx(async (db) => {
      const u = await db.createUser();
      const project = await createProject(db, u);
      await db.as(u);
      const job = await db.one<{ id: string; status: string }>(
        "insert into public.jobs (project_id, type, payload, created_by) values ($1, 'video.ingest', '{}', $2) returning id, status",
        [project, u],
      );
      expect(job.status).toBe("pending");

      await db.fails(
        "insert into public.jobs (project_id, type, status, created_by) values ($1, 'video.ingest', 'running', $2)",
        [project, u],
        /row-level security/,
      );
      await db.fails("update public.jobs set status = 'completed' where id = $1", [job.id], /permission denied/);
      await db.fails("select * from public.claim_jobs('w', null, 1)", [], /permission denied/);

      const cancelled = await db.one<{ status: string }>("select status from public.cancel_job($1)", [job.id]);
      expect(cancelled.status).toBe("cancelled");
    }));
});

describe("job queue — worker side (service role)", () => {
  it("retries with backoff, then fails permanently after max_attempts", () =>
    tx(async (db) => {
      await db.asAdmin();
      const type = `test.retry_${suffix()}`;
      await db.q("insert into public.jobs (type, max_attempts) values ($1, 2)", [type]);

      const [first] = await db.q<{ id: string; attempts: number }>("select * from public.claim_jobs('w1', array[$1], 1)", [type]);
      expect(first.attempts).toBe(1);
      const retried = await db.one<{ status: string; run_after: Date; error_message: string }>(
        "select * from public.fail_job($1, 'ffmpeg exited 1')",
        [first.id],
      );
      expect(retried.status).toBe("pending");
      expect(retried.error_message).toBe("ffmpeg exited 1");
      expect(retried.run_after.getTime()).toBeGreaterThan(Date.now());

      // not claimable before run_after
      expect(await db.q("select * from public.claim_jobs('w1', array[$1], 1)", [type])).toHaveLength(0);
      await db.q("update public.jobs set run_after = now() where id = $1", [first.id]);
      await db.q("select * from public.claim_jobs('w1', array[$1], 1)", [type]);
      const failed = await db.one<{ status: string; finished_at: Date | null }>("select * from public.fail_job($1, 'again')", [first.id]);
      expect(failed.status).toBe("failed");
      expect(failed.finished_at).not.toBeNull();
    }));

  it("completes running jobs and requeues stale leases", () =>
    tx(async (db) => {
      await db.asAdmin();
      const type = `test.lease_${suffix()}`;
      await db.q("insert into public.jobs (type) values ($1), ($1)", [type]);
      const claimed = await db.q<{ id: string }>("select * from public.claim_jobs('w1', array[$1], 2)", [type]);
      expect(claimed).toHaveLength(2);

      const done = await db.one<{ status: string; result: unknown }>(
        "select * from public.complete_job($1, '{\"clips\": 3}')",
        [claimed[0].id],
      );
      expect(done).toMatchObject({ status: "completed", result: { clips: 3 } });
      await db.fails("select public.complete_job($1)", [claimed[0].id], /JOB_NOT_RUNNING/);

      await db.q("update public.jobs set locked_at = now() - interval '2 hours' where id = $1", [claimed[1].id]);
      const requeued = await db.one<{ n: number }>("select public.requeue_stale_jobs(interval '30 minutes') as n");
      expect(requeued.n).toBeGreaterThanOrEqual(1);
      expect((await db.one<{ status: string }>("select status from public.jobs where id = $1", [claimed[1].id])).status).toBe("pending");
    }));

  it("never hands the same job to two concurrent workers (SKIP LOCKED)", async () => {
    const type = `test.concurrency_${suffix()}`;
    await pool.query("insert into public.jobs (type) select $1 from generate_series(1, 6)", [type]);
    try {
      const claim = (worker: string) =>
        pool.query<{ id: string }>("select id from public.claim_jobs($1, array[$2], 2)", [worker, type]);
      const results = await Promise.all(["a", "b", "c"].map(claim));
      const ids = results.flatMap((r) => r.rows.map((row) => row.id));
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    } finally {
      await pool.query("delete from public.jobs where type = $1", [type]);
    }
  });
});

describe("storage policies", () => {
  it("scopes objects to the project folder", () =>
    tx(async (db) => {
      const alice = await db.createUser();
      const bob = await db.createUser();
      const project = await createProject(db, alice);

      await db.as(alice);
      await db.q("insert into storage.objects (bucket_id, name, owner_id) values ('videos', $1, $2)", [`${project}/raw/match.mp4`, alice]);

      await db.as(bob);
      expect(await db.q("select name from storage.objects where bucket_id = 'videos' and name like $1", [`${project}/%`])).toHaveLength(0);
      await db.fails(
        "insert into storage.objects (bucket_id, name, owner_id) values ('videos', $1, $2)",
        [`${project}/raw/intrusion.mp4`, bob],
        /row-level security/,
      );
      await db.fails(
        "insert into storage.objects (bucket_id, name, owner_id) values ('videos', 'no-project-folder.mp4', $1)",
        [bob],
        /row-level security/,
      );
    }));
});
