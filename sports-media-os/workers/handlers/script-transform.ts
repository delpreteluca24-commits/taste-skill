import { parseGuardError } from "@/lib/db/errors";
import { transformDraft, summariseUsage } from "@/lib/scripts/generate";
import { SCRIPT_SECTIONS, type ScriptSections } from "@/lib/scripts/schema";
import { insertScriptVersion, loadStoryMaterial } from "@/lib/scripts/service";
import type { Json } from "@/types/database";
import { SCRIPT_TRANSFORM_PROMPT_VERSION } from "@/prompts/script/transform";

import { defineHandler, JobInputError } from "../context";

/**
 * script.transform — a NEW version derived from an existing one (SCRIPT task,
 * agent 'story'): regenerate, shorten, expand, rewrite_hook, change_tone.
 *
 * - the parent version is loaded with ctx.loadOwned (must belong to the job's project)
 * - versions are immutable: the result is always a new row with
 *   parent_script_id = parent, the same angle, operation = the transform
 * - rewrite_hook keeps the parent's other sections verbatim; change_tone stores
 *   the requested tone; other operations keep the parent's tone
 * - grounded like every AI draft; becomes current only when the story has no
 *   current script — a person switches versions ("Make current")
 */
export const handler = defineHandler({
  type: "script.transform",
  async run(ctx, payload) {
    const parent = await ctx.loadOwned("scripts", payload.scriptId);
    const tone = payload.tone?.trim() || null;
    if (payload.operation === "change_tone" && !tone) throw new JobInputError("change_tone needs a tone");

    const material = await loadStoryMaterial(ctx.db, ctx.projectId, parent.story_id);
    if (material.error) {
      if (parseGuardError(material.error)?.code === "NOT_FOUND") throw new JobInputError(`story ${parent.story_id} not found in this project`);
      throw new Error(`could not load the story material: ${material.error.message}`);
    }
    const { context } = material.data;
    const sections = Object.fromEntries(SCRIPT_SECTIONS.map((s) => [s.key, parent[s.key] ?? ""])) as ScriptSections;
    if (SCRIPT_SECTIONS.every((s) => !sections[s.key].trim())) throw new JobInputError(`script ${parent.id} has no text to transform`);

    return ctx.withAgentRun(
      "story",
      {
        task: "script.transform",
        scriptId: parent.id,
        storyId: parent.story_id,
        operation: payload.operation,
        promptVersion: SCRIPT_TRANSFORM_PROMPT_VERSION,
      },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const { draft, meta } = await transformDraft(
          ai,
          context,
          { angle: parent.angle, sections, tone: parent.tone, factsUsed: parent.facts_used ?? [] },
          payload.operation,
          tone,
        );
        const saved = await insertScriptVersion(ctx.db, {
          projectId: ctx.projectId,
          storyId: parent.story_id,
          draft,
          operation: payload.operation,
          parentId: parent.id,
          tone: payload.operation === "change_tone" ? tone : parent.tone,
          language: context.language,
          provider: meta.provider,
          model: meta.model,
          createdBy: ctx.job.created_by,
          makeCurrent: "if_none",
        });
        if (saved.error) throw new Error(`could not save the new version: ${saved.error.message}`);

        const usage = summariseUsage([meta]);
        await ctx.db
          .from("agent_runs")
          .update({ provider: usage.provider, model: usage.model, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut, cost_usd: usage.costUsd })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);

        const checks = draft.checks;
        await ctx.activity({
          agent: "story",
          action: "script.transformed",
          entityType: "script",
          entityId: saved.data.id,
          status: checks.droppedFactIds.length + checks.ungroundedNumbers.length + checks.unbackedQuotes.length > 0 ? "warning" : "success",
          metadata: {
            operation: payload.operation,
            parentId: parent.id,
            version: saved.data.version,
            warnings: draft.warnings.length,
            model: usage.model,
            costUsd: usage.costUsd,
          } as Json,
        });

        const summary = {
          promptVersion: SCRIPT_TRANSFORM_PROMPT_VERSION,
          provider: usage.provider,
          model: usage.model,
          costUsd: usage.costUsd,
          operation: payload.operation,
          parentId: parent.id,
          scriptId: saved.data.id,
          version: saved.data.version,
          isCurrent: saved.data.isCurrent,
          warnings: draft.warnings.length,
        };
        return { result: summary as Json, output: { scriptId: saved.data.id, version: saved.data.version } as Json };
      },
    );
  },
});
