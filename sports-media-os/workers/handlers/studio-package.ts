import { summariseUsage } from "@/lib/scripts/generate";
import { loadStoryMaterial } from "@/lib/scripts/service";
import type { Json } from "@/types/database";
import {
  buildStudioMessages,
  overallTitleScore,
  STUDIO_PROMPT_VERSION,
  STUDIO_SYSTEM,
  studioOutputSchema,
} from "@/prompts/studio/package";

import { defineHandler, JobInputError } from "../context";

/**
 * studio.package — honest titles + footage-free thumbnail briefs for one
 * content item (SCRIPT task, agent 'thumbnail'). Nothing is selected here:
 * a person picks the title in Studio.
 */
export const handler = defineHandler({
  type: "studio.package",
  async run(ctx, payload) {
    const item = await ctx.loadOwned("content_items", payload.contentItemId);
    if (!item.story_id) throw new JobInputError("This piece has no story yet. Create the story in the Pipeline first.");
    const material = await loadStoryMaterial(ctx.db, ctx.projectId, item.story_id);
    if (material.error) throw new Error(`could not load the story material: ${material.error.message}`);
    const { context } = material.data;
    if (context.facts.length === 0) throw new JobInputError("Add at least one research fact before packaging.");

    return ctx.withAgentRun(
      "thumbnail",
      { task: "studio.package", contentItemId: item.id, promptVersion: STUDIO_PROMPT_VERSION },
      async (runId) => {
        const ai = await ctx.ai({ agentRunId: runId });
        const res = await ai.generateObject(
          "script",
          { system: STUDIO_SYSTEM, messages: buildStudioMessages(context, { titles: 5, thumbnails: 3 }), cacheSystemPrompt: true },
          studioOutputSchema,
        );
        const titles = res.data.titles
          .map((t) => ({ ...t, text: t.text.trim().replace(/\s+/g, " ") }))
          .filter((t, i, all) => t.text.length > 0 && all.findIndex((o) => o.text.toLowerCase() === t.text.toLowerCase()) === i)
          .slice(0, 5);
        const thumbs = res.data.thumbnails.slice(0, 3);
        if (titles.length === 0 && thumbs.length === 0) throw new JobInputError("The model returned nothing usable. Add more facts and try again.");

        if (titles.length) {
          const { error } = await ctx.db.from("titles").insert(
            titles.map((t) => ({
              project_id: ctx.projectId,
              content_item_id: item.id,
              text: t.text.slice(0, 200),
              curiosity_score: t.curiosity,
              clarity_score: t.clarity,
              ctr_potential_score: t.ctr_potential,
              accuracy_score: t.accuracy,
              overall_score: overallTitleScore(t),
              provider: res.provider,
              model: res.model,
            })),
          );
          if (error) throw new Error(`could not save titles: ${error.message}`);
        }
        if (thumbs.length) {
          const { error } = await ctx.db.from("thumbnails").insert(
            thumbs.map((t) => ({
              project_id: ctx.projectId,
              content_item_id: item.id,
              headline: t.headline.slice(0, 120),
              visual_concept: t.visual_concept,
              emotion: t.emotion,
              contrast: t.contrast,
              curiosity_angle: t.curiosity_angle,
              image_prompt: t.image_prompt,
              provider: res.provider,
              model: res.model,
            })),
          );
          if (error) throw new Error(`could not save thumbnail briefs: ${error.message}`);
        }

        const usage = summariseUsage([{ provider: res.provider, model: res.model, usage: res.usage, costUsd: res.costUsd, promptVersion: STUDIO_PROMPT_VERSION }]);
        await ctx.db
          .from("agent_runs")
          .update({ provider: usage.provider, model: usage.model, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut, cost_usd: usage.costUsd })
          .eq("id", runId)
          .eq("project_id", ctx.projectId);
        await ctx.activity({
          agent: "thumbnail",
          action: "studio.packaged",
          entityType: "content_item",
          entityId: item.id,
          status: "success",
          metadata: { titles: titles.length, thumbnails: thumbs.length, model: usage.model, costUsd: usage.costUsd } as Json,
        });
        const summary = { titles: titles.length, thumbnails: thumbs.length, model: usage.model, costUsd: usage.costUsd };
        return { result: summary as unknown as Json, output: summary as unknown as Json };
      },
    );
  },
});
