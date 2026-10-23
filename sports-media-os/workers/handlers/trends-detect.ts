import { createFromTrend } from "@/lib/opportunities/service";
import { detectionRunningAhead, detectTrends } from "@/lib/trends/service";
import type { Json } from "@/types/database";

import { defineHandler, type JobContext } from "../context";

/** at most this many "new sweet spot" entries per run in the activity log */
const MAX_SWEET_SPOT_ACTIVITY = 10;

/**
 * Auto-promotion: after each detection the strongest fresh trends become
 * scored opportunities (heuristic score, no AI needed), so the Opportunities
 * list fills itself every day. Bounded per run and per day; a trend that
 * already has an open (or rejected) opportunity is never promoted again.
 */
export const AUTO_PROMOTE = { minRadarScore: 50, perRun: 5, perDay: 10, freshHours: 48 } as const;

async function promoteTopTrends(ctx: JobContext): Promise<string[]> {
  const since = new Date(Date.now() - AUTO_PROMOTE.freshHours * 3600_000).toISOString();
  const dayStart = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: candidates }, { count: today }, { data: taken }] = await Promise.all([
    ctx.db
      .from("trends")
      .select("id, title, radar_score")
      .eq("project_id", ctx.projectId)
      .in("status", ["emerging", "rising", "peaking"])
      .gte("last_seen_at", since)
      .gte("radar_score", AUTO_PROMOTE.minRadarScore)
      .order("radar_score", { ascending: false })
      .limit(30),
    ctx.db
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ctx.projectId)
      .gte("created_at", dayStart)
      .contains("metadata", { auto_promoted: true }),
    ctx.db.from("opportunities").select("trend_id").eq("project_id", ctx.projectId).not("trend_id", "is", null),
  ]);
  const used = new Set((taken ?? []).map((o) => o.trend_id));
  const budget = Math.max(0, Math.min(AUTO_PROMOTE.perRun, AUTO_PROMOTE.perDay - (today ?? 0)));
  const picked = (candidates ?? []).filter((t) => !used.has(t.id)).slice(0, budget);

  const created: string[] = [];
  for (const t of picked) {
    const res = await createFromTrend(ctx.db, { projectId: ctx.projectId, trendId: t.id, userId: null });
    if (res.error || res.data.existing) continue;
    await ctx.db
      .from("opportunities")
      .update({ metadata: { created_from: "trend", trend_radar_score: t.radar_score, auto_promoted: true } })
      .eq("id", res.data.id)
      .eq("project_id", ctx.projectId);
    created.push(res.data.id);
    await ctx.activity({
      agent: "trend_hunter",
      action: "opportunity.auto_created",
      entityType: "opportunity",
      entityId: res.data.id,
      status: "info",
      metadata: { title: t.title, radarScore: t.radar_score },
    });
  }
  return created;
}

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

      const promoted = await promoteTopTrends(ctx);
      const out = { ...summary, opportunitiesCreated: promoted.length };
      return { result: out as unknown as Json, output: out as unknown as Json };
    });
  },
});
