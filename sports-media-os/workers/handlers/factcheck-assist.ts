import { requestFactCheck } from "@/lib/factcheck/assess";
import { buildStoredSuggestion } from "@/lib/factcheck/sanitize";
import { loadClaimEvidence, saveClaimAISuggestion } from "@/lib/research/service";
import type { Json } from "@/types/database";
import { FACTCHECK_ASSESS_PROMPT_VERSION } from "@/prompts/factcheck/assess";

import { defineHandler, JobInputError } from "../context";

/**
 * factcheck.assist — AI assessment of one claim (FACT_CHECK task, agent
 * 'fact_checker').
 *
 * - the claim id is loaded with ctx.loadOwned (must belong to the job's project)
 * - the model sees ONLY the claim and its linked sources' titles, summaries and excerpts
 * - the sanitised assessment is stored in facts.ai_suggestion (model + timestamp);
 *   status, confidence and checker are NEVER changed here — a person applies it
 */
export const handler = defineHandler({
  type: "factcheck.assist",
  async run(ctx, payload) {
    const fact = await ctx.loadOwned("facts", payload.factId);
    const evidence = await loadClaimEvidence(ctx.db, ctx.projectId, fact.id);
    if (evidence.error) throw new Error(`could not load the claim's sources: ${evidence.error.message}`);
    const { sources } = evidence.data;
    if (sources.length === 0) {
      throw new JobInputError("Link at least one source to this claim before asking AI to assess it");
    }

    return ctx.withAgentRun(
      "fact_checker",
      { task: "factcheck.assist", factId: fact.id, promptVersion: FACTCHECK_ASSESS_PROMPT_VERSION, sources: sources.length },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const res = await requestFactCheck(ai, { claim: { text: fact.claim, isCritical: fact.is_critical }, sources });

        const stored = buildStoredSuggestion(res.suggestion, {
          claim: fact.claim,
          assessedSourceIds: res.assessedSourceIds,
          provider: res.provider,
          model: res.model,
          promptVersion: FACTCHECK_ASSESS_PROMPT_VERSION,
          at: new Date(),
          jobId: ctx.job.id,
          costUsd: res.costUsd,
        });
        const saved = await saveClaimAISuggestion(ctx.db, { projectId: ctx.projectId, factId: fact.id, suggestion: stored });
        if (saved.error) throw new Error(`could not save the assessment: ${saved.error.message}`);

        await ctx.db
          .from("agent_runs")
          .update({
            provider: res.provider,
            model: res.model,
            tokens_in: res.usage.inputTokens + res.usage.cacheReadTokens + res.usage.cacheWriteTokens,
            tokens_out: res.usage.outputTokens,
            cost_usd: res.costUsd,
          })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);

        await ctx.activity({
          agent: "fact_checker",
          action: "factcheck.assessed",
          entityType: "fact",
          entityId: fact.id,
          status: stored.adjustment || stored.droppedSourceIds > 0 ? "warning" : "success",
          metadata: {
            suggestedStatus: stored.suggestedStatus,
            confidence: stored.confidence,
            adjustment: stored.adjustment,
            droppedSourceIds: stored.droppedSourceIds,
            model: res.model,
            costUsd: res.costUsd,
          } as Json,
        });

        const summary = {
          promptVersion: FACTCHECK_ASSESS_PROMPT_VERSION,
          provider: res.provider,
          model: res.model,
          costUsd: res.costUsd,
          suggestedStatus: stored.suggestedStatus,
          confidence: stored.confidence,
          adjustment: stored.adjustment,
          droppedSourceIds: stored.droppedSourceIds,
        };
        return { result: summary as Json, output: { suggestedStatus: stored.suggestedStatus, confidence: stored.confidence } as Json };
      },
    );
  },
});
