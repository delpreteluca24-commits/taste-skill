import { parseGuardError } from "@/lib/db/errors";
import { summariseUsage } from "@/lib/scripts/generate";
import { generateHookSet } from "@/lib/scripts/hooks";
import { insertGeneratedHooks, listHookTexts, loadStoryMaterial } from "@/lib/scripts/service";
import type { Json } from "@/types/database";
import { HOOKS_PROMPT_VERSION } from "@/prompts/hooks/generate";

import { defineHandler, JobInputError } from "../context";

/**
 * hooks.generate — scored hooks across the hook types for one story (SCRIPT
 * task, agent 'hook').
 *
 * - the story id is loaded with ctx.loadOwned (must belong to the job's project)
 * - the model sees ONLY the story's research material and the existing hooks
 *   (so it doesn't repeat them)
 * - hooks are cleaned, deduplicated, fact ids validated against the provided set
 * - score = round(0.6 × transparent heuristic + 0.4 × the model's score)
 *   (lib/scripts/hooks.ts); both parts and every factor go to score_explanation
 * - nothing is selected here: a person picks the hook
 */
export const handler = defineHandler({
  type: "hooks.generate",
  async run(ctx, payload) {
    const story = await ctx.loadOwned("stories", payload.storyId);
    const [material, existing] = await Promise.all([
      loadStoryMaterial(ctx.db, ctx.projectId, story.id),
      listHookTexts(ctx.db, ctx.projectId, story.id),
    ]);
    if (material.error) {
      if (parseGuardError(material.error)?.code === "NOT_FOUND") throw new JobInputError(`story ${story.id} not found in this project`);
      throw new Error(`could not load the story material: ${material.error.message}`);
    }
    if (existing.error) throw new Error(`could not load the existing hooks: ${existing.error.message}`);
    const { story: ref, context } = material.data;
    const count = payload.count ?? 5;

    return ctx.withAgentRun(
      "hook",
      { task: "hooks.generate", storyId: story.id, count, promptVersion: HOOKS_PROMPT_VERSION, facts: context.facts.length },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const { result, meta } = await generateHookSet(ai, context, { count, existing: existing.data });
        if (result.hooks.length === 0) {
          // permanent: the same material would give the same result (the call is already in ai_usage)
          throw new JobInputError("No usable hooks came back (empty or repeats of existing hooks). Add research facts, then try again.");
        }

        const saved = await insertGeneratedHooks(ctx.db, {
          projectId: ctx.projectId,
          story: ref,
          hooks: result.hooks,
          provider: meta.provider,
          model: meta.model,
        });
        if (saved.error) throw new Error(`could not save the hooks: ${saved.error.message}`);

        const usage = summariseUsage([meta]);
        await ctx.db
          .from("agent_runs")
          .update({ provider: usage.provider, model: usage.model, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut, cost_usd: usage.costUsd })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);

        const short = result.hooks.length < count;
        await ctx.activity({
          agent: "hook",
          action: "hooks.generated",
          entityType: "story",
          entityId: story.id,
          status: short || result.dropped.foreignFactIds > 0 ? "warning" : "success",
          metadata: {
            inserted: saved.data.ids.length,
            requested: count,
            distinctTypes: result.distinctTypes,
            dropped: result.dropped,
            model: usage.model,
            costUsd: usage.costUsd,
          } as Json,
        });

        const summary = {
          promptVersion: HOOKS_PROMPT_VERSION,
          provider: usage.provider,
          model: usage.model,
          costUsd: usage.costUsd,
          requested: count,
          inserted: saved.data.ids.length,
          distinctTypes: result.distinctTypes,
          dropped: result.dropped,
          missing: result.missing,
        };
        return { result: summary as unknown as Json, output: { inserted: saved.data.ids.length, distinctTypes: result.distinctTypes } as Json };
      },
    );
  },
});
