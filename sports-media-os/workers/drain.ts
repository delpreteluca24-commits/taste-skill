import type { Db } from "./context";

import { pollOnce, scheduleDueConnectors, type HandlerMap } from "./runner";

/**
 * Serverless alternative to the long-running worker: run queued jobs until the
 * queue is empty or the time budget is spent. Safe alongside `npm run worker`
 * (jobs are claimed with FOR UPDATE SKIP LOCKED).
 */
export async function drainJobs(
  db: Db,
  handlers: HandlerMap,
  workerId: string,
  { budgetMs, concurrency = 2 }: { budgetMs: number; concurrency?: number },
): Promise<{ ran: number; scheduled: number }> {
  const deadline = Date.now() + budgetMs;
  await db.rpc("requeue_stale_jobs", { p_timeout: "30 minutes" });
  const scheduled = await scheduleDueConnectors(db);
  let ran = 0;
  while (Date.now() < deadline) {
    const n = await pollOnce(db, handlers, workerId, concurrency);
    if (n === 0) break;
    ran += n;
  }
  return { ran, scheduled };
}
