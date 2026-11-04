import { parseGuardError } from "@/lib/db/errors";
import { generateAngleDraft, summariseUsage, type AIMeta } from "@/lib/scripts/generate";
import { insertScriptVersion, loadStoryMaterial } from "@/lib/scripts/service";
import type { ScriptAngle } from "@/lib/scripts/schema";
import type { Json } from "@/types/database";
import { SCRIPT_PROMPT_VERSION } from "@/prompts/script/angles";

import { defineHandler, JobInputError } from "../context";

/**
 * script.generate — one script version per requested angle (SCRIPT task,
 * agent 'story').
 *
 * - the story id is loaded with ctx.loadOwned (must belong to the job's project)
 * - the model sees ONLY the story's research material (facts with ids and
 *   status, sources, quotes, production formats)
 * - every draft is grounded before it is stored: foreign fact ids dropped,
 *   numbers / quotes / unconfirmed claims not backed by the research become
 *   warnings on the version (scripts.warnings)
 * - versions are inserted as operation 'generate'; the first one becomes
 *   current ONLY when the story has no current script (an AI version never
 *   replaces a current, possibly approved, script). Nothing is approved here.
 * - one angle failing does not lose the others: the job completes with the
 *   failures listed; it fails (and may retry) only when no angle succeeded,
 *   so a retry never duplicates stored versions
 */
export const handler = defineHandler({
  type: "script.generate",
  async run(ctx, payload) {
    const story = await ctx.loadOwned("stories", payload.storyId);
    const material = await loadStoryMaterial(ctx.db, ctx.projectId, story.id);
    if (material.error) {
      if (parseGuardError(material.error)?.code === "NOT_FOUND") throw new JobInputError(`story ${story.id} not found in this project`);
      throw new Error(`could not load the story material: ${material.error.message}`);
    }
    const { context } = material.data;
    const angles = [...new Set(payload.angles)] as ScriptAngle[];

    return ctx.withAgentRun(
      "story",
      {
        task: "script.generate",
        storyId: story.id,
        angles,
        promptVersion: SCRIPT_PROMPT_VERSION,
        facts: context.facts.length,
        quotes: context.quotes.length,
      },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const metas: AIMeta[] = [];
        const created: {
          angle: ScriptAngle;
          scriptId: string;
          version: number;
          isCurrent: boolean;
          warnings: number;
          droppedFactIds: number;
          ungroundedNumbers: number;
          unbackedQuotes: number;
        }[] = [];
        const failed: { angle: ScriptAngle; error: string }[] = [];
        let firstError: unknown = null;

        for (const angle of angles) {
          try {
            const { draft, meta } = await generateAngleDraft(ai, context, angle);
            metas.push(meta);
            const saved = await insertScriptVersion(ctx.db, {
              projectId: ctx.projectId,
              storyId: story.id,
              draft,
              operation: "generate",
              parentId: null,
              tone: null,
              language: context.language,
              provider: meta.provider,
              model: meta.model,
              createdBy: ctx.job.created_by,
              makeCurrent: "if_none",
            });
            if (saved.error) throw new Error(`could not save the ${angle} version: ${saved.error.message}`);
            created.push({
              angle,
              scriptId: saved.data.id,
              version: saved.data.version,
              isCurrent: saved.data.isCurrent,
              warnings: draft.warnings.length,
              droppedFactIds: draft.checks.droppedFactIds.length,
              ungroundedNumbers: draft.checks.ungroundedNumbers.length,
              unbackedQuotes: draft.checks.unbackedQuotes.length,
            });
          } catch (e) {
            firstError ??= e;
            failed.push({ angle, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
            ctx.log("script.generate.angle_failed", { angle });
          }
        }
        if (created.length === 0) throw firstError ?? new Error("no script was generated");

        const usage = summariseUsage(metas);
        await ctx.db
          .from("agent_runs")
          .update({ provider: usage.provider, model: usage.model, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut, cost_usd: usage.costUsd })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);

        // anything the model tried beyond the research is a warning in the Agent Center
        const beyondResearch = created.some((c) => c.droppedFactIds + c.ungroundedNumbers + c.unbackedQuotes > 0);
        await ctx.activity({
          agent: "story",
          action: "script.generated",
          entityType: "story",
          entityId: story.id,
          status: failed.length || beyondResearch ? "warning" : "success",
          metadata: { created, failed, model: usage.model, costUsd: usage.costUsd } as Json,
        });

        const summary = {
          promptVersion: SCRIPT_PROMPT_VERSION,
          provider: usage.provider,
          model: usage.model,
          costUsd: usage.costUsd,
          factsProvided: context.facts.length,
          created,
          failed,
        };
        return {
          result: summary as unknown as Json,
          output: { versions: created.map((c) => c.scriptId), failed: failed.length } as Json,
        };
      },
    );
  },
});
