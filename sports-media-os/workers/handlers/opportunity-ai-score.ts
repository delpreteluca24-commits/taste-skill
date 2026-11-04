import { AIError } from "@/lib/ai/types";
import type { Tables } from "@/lib/db/client";
import { batchBudgetUsd } from "@/lib/opportunities/ai-cost";
import { applyAIScores, requestAIScores, type RejectedComponent } from "@/lib/opportunities/ai-scoring";
import { loadScoringContexts } from "@/lib/opportunities/service";
import { aiSettingsSchema } from "@/lib/settings/schema";
import { OPPORTUNITY_SCORING_PROMPT_VERSION } from "@/prompts/scoring/opportunity";
import type { Json } from "@/types/database";

import { defineHandler, type JobContext } from "../context";

/**
 * opportunity.ai_score — refine curiosity / originality / audience / monetization
 * with the SCORING task model, one call per opportunity (system prompt cached).
 *
 * - every payload id is loaded with ctx.loadOwned (must belong to the job's project)
 * - AI values get origin 'ai' and NEVER replace a manual value
 * - the score is recomputed and stored with its explanation
 * - spending stops at the batch budget (Settings limit, or the cost the user confirmed)
 */

type ItemResult = {
  opportunityId: string;
  status: "scored" | "skipped" | "failed";
  applied?: string[];
  keptManual?: string[];
  rejected?: RejectedComponent[];
  score?: number | null;
  costUsd?: number | null;
  reason?: string;
};

async function loadBatchLimit(ctx: JobContext): Promise<number> {
  const { data } = await ctx.db.from("settings").select("value").is("project_id", null).eq("key", "ai").maybeSingle();
  const parsed = aiSettingsSchema.safeParse(data?.value ?? {});
  return (parsed.success ? parsed.data : aiSettingsSchema.parse({})).batchCostLimitUsd;
}

function round6(v: number) {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export const handler = defineHandler({
  type: "opportunity.ai_score",
  async run(ctx, payload) {
    const ids = [...new Set(payload.opportunityIds)];
    // service role: an id from another project fails the job here (JobInputError, no retry)
    const rows: Tables<"opportunities">[] = [];
    for (const id of ids) rows.push(await ctx.loadOwned("opportunities", id));

    const budgetUsd = batchBudgetUsd(await loadBatchLimit(ctx), payload.confirmedCostUsd);
    const contexts = await loadScoringContexts(ctx.db, ctx.projectId, rows);

    return ctx.withAgentRun(
      "trend_hunter",
      { task: "opportunity.ai_score", opportunityIds: ids, promptVersion: OPPORTUNITY_SCORING_PROMPT_VERSION, budgetUsd },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const results: ItemResult[] = [];
        let totalCostUsd = 0;
        let unpricedCalls = 0;
        let tokensIn = 0;
        let tokensOut = 0;
        let lastModel: { provider: string; model: string } | null = null;

        for (const row of rows) {
          if (totalCostUsd >= budgetUsd) {
            results.push({ opportunityId: row.id, status: "skipped", reason: `Batch budget of $${budgetUsd} reached` });
            continue;
          }
          try {
            const res = await requestAIScores(ai, row, contexts.get(row.id) ?? { sportName: null, sources: [] });
            if (!res) {
              results.push({ opportunityId: row.id, status: "skipped", reason: "Every AI-scored component was set manually" });
              continue;
            }
            lastModel = { provider: res.provider, model: res.model };
            if (res.costUsd === null) unpricedCalls += 1;
            else totalCostUsd += res.costUsd;
            tokensIn += res.usage.inputTokens + res.usage.cacheReadTokens + res.usage.cacheWriteTokens;
            tokensOut += res.usage.outputTokens;

            // re-read: a human may have overridden a component while the model was thinking
            const fresh = await ctx.loadOwned("opportunities", row.id);
            const { columns, applied, keptManual } = applyAIScores(fresh, res.accepted);
            const metadata = {
              ...((fresh.metadata ?? {}) as Record<string, Json>),
              ai_scoring: {
                at: new Date().toISOString(),
                provider: res.provider,
                model: res.model,
                promptVersion: OPPORTUNITY_SCORING_PROMPT_VERSION,
                costUsd: res.costUsd,
                applied,
                keptManual,
                rejected: res.rejected,
                jobId: ctx.job.id,
              },
            } as { [key: string]: Json };
            const { error } = await ctx.db
              .from("opportunities")
              .update({ ...columns, metadata })
              .eq("id", row.id)
              .eq("project_id", ctx.projectId);
            if (error) throw new Error(`could not save the score: ${error.message}`);

            await ctx.activity({
              agent: "trend_hunter",
              action: "opportunity.ai_scored",
              entityType: "opportunity",
              entityId: row.id,
              // a protected manual value is expected; anything else rejected is a model-output problem
              status: res.rejected.some((r) => r.code !== "manual") ? "warning" : "success",
              metadata: { applied, keptManual, rejected: res.rejected, model: res.model, costUsd: res.costUsd } as Json,
            });
            results.push({
              opportunityId: row.id,
              status: "scored",
              applied,
              keptManual,
              rejected: res.rejected,
              score: (columns.opportunity_score as number | null | undefined) ?? null,
              costUsd: res.costUsd,
            });
          } catch (e) {
            // no provider configured: every item would fail the same way → fail the job clearly
            if (e instanceof AIError && e.kind === "not_configured") throw e;
            const reason = (e instanceof Error ? e.message : String(e)).slice(0, 300);
            ctx.log("opportunity.ai_score_item_failed", { opportunityId: row.id, reason });
            await ctx.activity({
              agent: "trend_hunter",
              action: "opportunity.ai_score_failed",
              entityType: "opportunity",
              entityId: row.id,
              status: "failed",
              metadata: { reason },
            });
            results.push({ opportunityId: row.id, status: "failed", reason });
          }
        }

        const scored = results.filter((r) => r.status === "scored").length;
        const failed = results.filter((r) => r.status === "failed").length;
        if (scored === 0 && failed > 0) {
          // transient failures (outage, invalid output): let the queue retry the whole batch
          throw new Error(`AI scoring failed for every opportunity: ${results.find((r) => r.reason)?.reason ?? "unknown error"}`);
        }

        totalCostUsd = round6(totalCostUsd);
        await ctx.db
          .from("agent_runs")
          .update({
            provider: lastModel?.provider ?? null,
            model: lastModel?.model ?? null,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            cost_usd: unpricedCalls > 0 && totalCostUsd === 0 ? null : totalCostUsd,
          })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);

        const summary = {
          promptVersion: OPPORTUNITY_SCORING_PROMPT_VERSION,
          budgetUsd,
          totalCostUsd,
          unpricedCalls,
          scored,
          skipped: results.filter((r) => r.status === "skipped").length,
          failed,
          results,
        };
        return { result: summary as unknown as Json, output: { scored, failed, totalCostUsd } };
      },
    );
  },
});
