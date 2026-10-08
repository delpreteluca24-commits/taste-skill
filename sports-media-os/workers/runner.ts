import { z } from "zod";

import { AIError } from "@/lib/ai/types";
import { isJobType, JOB_PAYLOAD_SCHEMAS, type JobType } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

import { createJobContext, JobInputError, type Db, type JobHandler, type JobRow } from "./context";

export type HandlerMap = Partial<{ [T in JobType]: JobHandler<T> }>;

/** Errors that will fail again on retry (bad input, missing config) */
function isPermanent(e: unknown): boolean {
  if (e instanceof JobInputError) return true;
  if (e instanceof AIError) return ["not_configured", "bad_request", "auth", "truncated"].includes(e.kind);
  return false;
}

export async function runJob(db: Db, handlers: HandlerMap, job: JobRow): Promise<"completed" | "failed"> {
  const fail = async (message: string, retry: boolean) => {
    await db.rpc("fail_job", { p_job_id: job.id, p_error: message.slice(0, 4000), p_retry: retry });
    logger.warn("worker.job_failed", { jobId: job.id, type: job.type, retry, message: message.slice(0, 300) });
    return "failed" as const;
  };

  if (!isJobType(job.type)) return fail(`unknown job type ${job.type}`, false);
  const handler = handlers[job.type] as JobHandler<JobType> | undefined;
  if (!handler) return fail(`no handler registered for ${job.type}`, false);

  const parsed = JOB_PAYLOAD_SCHEMAS[job.type].safeParse(job.payload);
  if (!parsed.success) return fail(`invalid payload: ${z.prettifyError(parsed.error)}`, false);

  try {
    const ctx = createJobContext(db, job);
    const started = Date.now();
    const result = await handler.run(ctx, parsed.data as never);
    const { error } = await db.rpc("complete_job", { p_job_id: job.id, p_result: (result ?? null) as Json });
    if (error) throw new Error(`complete_job failed: ${error.message}`);
    logger.info("worker.job_completed", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return "completed";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(message, !isPermanent(e));
  }
}

/** Claim and run up to `limit` jobs once. Returns how many ran. */
export async function pollOnce(db: Db, handlers: HandlerMap, workerId: string, limit = 2): Promise<number> {
  const types = Object.keys(handlers);
  if (types.length === 0) return 0;
  const { data, error } = await db.rpc("claim_jobs", { p_worker: workerId, p_types: types, p_limit: limit });
  if (error) {
    logger.error("worker.claim_failed", { message: error.message });
    return 0;
  }
  const jobs = (data ?? []) as JobRow[];
  await Promise.all(jobs.map((job) => runJob(db, handlers, job)));
  return jobs.length;
}

/**
 * Enqueue connector.fetch for enabled connectors whose interval elapsed.
 * Idempotency key per connector per interval slot → no duplicates across workers.
 */
export async function scheduleDueConnectors(db: Db, now = new Date()): Promise<number> {
  const { data: connectors, error } = await db
    .from("connectors")
    .select("id, project_id, fetch_interval_minutes, last_fetched_at")
    .eq("enabled", true)
    .limit(500);
  if (error) {
    logger.error("worker.schedule_failed", { message: error.message });
    return 0;
  }
  let enqueued = 0;
  for (const c of connectors ?? []) {
    const intervalMs = c.fetch_interval_minutes * 60_000;
    const last = c.last_fetched_at ? new Date(c.last_fetched_at).getTime() : 0;
    if (now.getTime() - last < intervalMs) continue;
    const slot = Math.floor(now.getTime() / intervalMs);
    const { error: insertError } = await db.from("jobs").insert({
      project_id: c.project_id,
      type: "connector.fetch",
      payload: { connectorId: c.id },
      priority: 40,
      idempotency_key: `connector.fetch:${c.id}:${slot}`,
    });
    if (!insertError) enqueued += 1;
    else if (insertError.code !== "23505") logger.warn("worker.schedule_insert_failed", { message: insertError.message });
  }
  return enqueued;
}
