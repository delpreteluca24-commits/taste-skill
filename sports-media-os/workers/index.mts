/**
 * Background worker: AI calls, source fetching, trend detection.
 *
 *   npm run worker            (uses .env.local; needs SUPABASE_SECRET_KEY)
 *
 * Runs anywhere Node runs (a container, a VPS, your laptop) — never inside a
 * serverless request. Safe to run several copies: jobs are claimed with
 * FOR UPDATE SKIP LOCKED.
 */
import { createServer } from "node:http";
import { hostname } from "node:os";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const { createAdminClient } = await import("@/lib/supabase/admin");
const { logger } = await import("@/lib/logger");
const { handlers } = await import("./handlers/index");
const { pollOnce, scheduleDueConnectors } = await import("./runner");

const db = createAdminClient();
const workerId = `${hostname()}:${process.pid}`;
const concurrency = Math.max(1, Math.min(8, Number(process.env.WORKER_CONCURRENCY ?? 2)));
const idleMs = Math.max(500, Number(process.env.WORKER_POLL_MS ?? 2000));

let stopping = false;
let lastPollAt = Date.now();
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

// Optional liveness endpoint for container orchestrators (and E2E): GET /health
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
const health = healthPort
  ? createServer((req, res) => {
      const stale = Date.now() - lastPollAt > 5 * 60_000;
      res.writeHead(req.url === "/health" && !stale ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: stale ? "stale" : "ok", workerId }));
    }).listen(healthPort, "127.0.0.1")
  : null;

logger.info("worker.started", { workerId, concurrency, handlers: Object.keys(handlers) });

let lastMaintenance = 0;
while (!stopping) {
  const now = Date.now();
  if (now - lastMaintenance > 60_000) {
    lastMaintenance = now;
    const { data: requeued } = await db.rpc("requeue_stale_jobs", { p_timeout: "30 minutes" });
    const scheduled = await scheduleDueConnectors(db);
    if (requeued || scheduled) logger.info("worker.maintenance", { requeued, scheduled });
  }
  const ran = await pollOnce(db, handlers, workerId, concurrency);
  lastPollAt = Date.now();
  if (ran === 0) await new Promise((r) => setTimeout(r, idleMs));
}

health?.close();
logger.info("worker.stopped", { workerId });
