import { detectionRunningAhead, detectTrends } from "@/lib/trends/service";
import type { Json } from "@/types/database";

import { defineHandler } from "../context";

/** at most this many "new sweet spot" entries per run in the activity log */
const MAX_SWEET_SPOT_ACTIVITY = 10;

/**
 * trends.detect — Trend Hunter for the job's project: signals → clustering →
 * radar metrics → trends + trend_sources (idempotent) → expiry of stale trends.
 *
 * Deterministic work costs nothing; the only AI call is one DISCOVERY-task
 * request (cheap model) that names up to 20 new trends from their headlines.
 * Without an AI key, or when the model fails or its labels do not pass
 * validation, the heuristic titles stay — detection never waits on AI.
 *
 * The service role bypasses RLS: detectTrends filters every query by
 * ctx.projectId, and the payload carries no entity ids.
 *
 * Two detections of one project never run at once (they could open duplicate
 * trends for the same new sources): the later one is re-queued with backoff,
 * and on its last attempt completes as skipped (the running one covers it).
 */
export const handler = defineHandler({
  type: "trends.detect",
  async run(ctx, payload) {
    const ahead = await detectionRunningAhead(ctx.db, ctx.projectId, ctx.job);
    if (ahead) {
      if (ctx.job.attempts < ctx.job.max_attempts) {
        throw new Error("another trend detection is running for this project; retrying shortly");
      }
      ctx.log("trends.detect_skipped", { runningJobId: ahead });
      return { skipped: true, reason: "another trend detection was running for this project and covered the same window" };
    }

    return ctx.withAgentRun("trend_hunter", { sinceHours: payload.sinceHours }, async (runId) => {
      const ai = await ctx.ai({ agentRunId: runId });
      const result = await detectTrends(ctx.db, ctx.projectId, { sinceHours: payload.sinceHours, ai });

      const summary = {
        sinceHours: result.sinceHours,
        sourcesScanned: result.sourcesScanned,
        signalsUpdated: result.signalsUpdated,
        clusters: result.clusters,
        trendsCreated: result.trendsCreated,
        trendsUpdated: result.trendsUpdated,
        sourcesLinked: result.sourcesLinked,
        unclustered: result.unclustered,
        trendsExpired: result.trendsExpired,
        sweetSpots: result.sweetSpots,
        ai: result.ai,
      };

      await ctx.activity({
        agent: "trend_hunter",
        action: "trends.detected",
        status: result.ai.status === "failed" ? "warning" : "success",
        metadata: summary as unknown as Json,
      });
      for (const t of result.newSweetSpots.slice(0, MAX_SWEET_SPOT_ACTIVITY)) {
        await ctx.activity({
          agent: "trend_hunter",
          action: "trend.sweet_spot",
          entityType: "trend",
          entityId: t.id,
          status: "info",
          metadata: { title: t.title },
        });
      }
      ctx.log("trends.detected", { ...summary, ai: result.ai.status });

      return { result: summary as unknown as Json, output: summary as unknown as Json };
    });
  },
});
