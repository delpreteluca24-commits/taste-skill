import { requestResearchSuggestions } from "@/lib/research/ai-suggest";
import { insertAISuggestions, loadSuggestContext } from "@/lib/research/service";
import type { Json } from "@/types/database";
import { RESEARCH_SUGGEST_PROMPT_VERSION } from "@/prompts/research/suggest";

import { defineHandler, JobInputError } from "../context";

/**
 * research.suggest — AI research plan for one opportunity (RESEARCH task,
 * agent 'researcher').
 *
 * - the opportunity id is loaded with ctx.loadOwned (must belong to the job's project)
 * - the model sees ONLY the opportunity fields and the workspace's sources
 * - output is sanitised: foreign source ids dropped, unsourced claims dropped
 *   (or kept as questions), nothing already in the workspace repeated
 * - claims are stored 'uncertain' with their sources linked as 'mentions';
 *   the agent never confirms or approves anything
 */
export const handler = defineHandler({
  type: "research.suggest",
  async run(ctx, payload) {
    const opportunity = await ctx.loadOwned("opportunities", payload.opportunityId);
    const context = await loadSuggestContext(ctx.db, ctx.projectId, opportunity.id);
    if (context.error) {
      if (context.error.message?.startsWith("NOT_FOUND")) throw new JobInputError(`opportunity ${opportunity.id} not found in this project`);
      throw new Error(`could not load the research workspace: ${context.error.message}`);
    }
    const { opportunity: input, sources, existing } = context.data;

    return ctx.withAgentRun(
      "researcher",
      {
        task: "research.suggest",
        opportunityId: opportunity.id,
        promptVersion: RESEARCH_SUGGEST_PROMPT_VERSION,
        sources: sources.length,
      },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const res = await requestResearchSuggestions(ai, { opportunity: input, sources }, existing);

        const saved = await insertAISuggestions(ctx.db, {
          projectId: ctx.projectId,
          opportunityId: opportunity.id,
          suggestions: res.suggestions,
          meta: { provider: res.provider, model: res.model, promptVersion: RESEARCH_SUGGEST_PROMPT_VERSION, jobId: ctx.job.id },
        });
        if (saved.error) throw new Error(`could not save the suggestions: ${saved.error.message}`);

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

        const dropped = res.suggestions.dropped;
        const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0) - dropped.claimsAsQuestions;
        await ctx.activity({
          agent: "researcher",
          action: "research.suggested",
          entityType: "opportunity",
          entityId: opportunity.id,
          // dropped foreign ids / unsourced claims mean the model tried to go beyond the sources
          status: dropped.foreignSourceIds + dropped.unsourcedClaims > 0 ? "warning" : "success",
          metadata: { inserted: saved.data, dropped, model: res.model, costUsd: res.costUsd } as Json,
        });

        const summary = {
          promptVersion: RESEARCH_SUGGEST_PROMPT_VERSION,
          provider: res.provider,
          model: res.model,
          costUsd: res.costUsd,
          sourcesProvided: res.providedSourceIds.length,
          inserted: saved.data,
          dropped,
          droppedTotal,
        };
        return { result: summary as unknown as Json, output: { inserted: saved.data, droppedTotal } as Json };
      },
    );
  },
});
