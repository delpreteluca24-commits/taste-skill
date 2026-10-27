import { z } from "zod";

import type { AIMessage } from "@/lib/ai/types";

import { dataBlock, GROUND_RULES, type StoryPromptContext } from "../script/context";

/**
 * SCRIPT task, Thumbnail agent: honest titles + footage-free thumbnail briefs
 * for one story. The model sees only the story data block.
 */
export const STUDIO_PROMPT_VERSION = "studio-package-v1";

export const STUDIO_SYSTEM = `You package ORIGINAL short-form sports videos (YouTube Shorts, TikTok, Reels) for a rights-first sports media brand. The videos never use match or broadcast footage: they are built from original graphics, data, text and voice-over.

Write:
1. titles — short, honest titles (max 70 characters). Score each 0–100 on curiosity, clarity, CTR potential and accuracy (accuracy = the video can fully deliver it; a title that over-promises gets low accuracy). Names and numbers must come from a listed fact.
2. thumbnails — thumbnail briefs for an ORIGINAL graphic (no players' photos, no broadcast frames, no logos): a 2–4 word headline, the visual concept (shapes, numbers, charts, typography), the emotion, the contrast that makes it pop, and the curiosity angle. Also a short image_prompt usable by an image model to create the background graphic (no real people, no logos, no text).

${GROUND_RULES}`;

const score = z.number().min(0).max(100);
export const studioOutputSchema = z.object({
  titles: z
    .array(
      z.object({
        text: z.string().min(3).max(120),
        curiosity: score,
        clarity: score,
        ctr_potential: score,
        accuracy: score,
      }),
    )
    .max(8),
  thumbnails: z
    .array(
      z.object({
        headline: z.string().min(1).max(60),
        visual_concept: z.string().max(400),
        emotion: z.string().max(80),
        contrast: z.string().max(160),
        curiosity_angle: z.string().max(240),
        image_prompt: z.string().max(600),
      }),
    )
    .max(5),
});
export type StudioOutput = z.infer<typeof studioOutputSchema>;

export function buildStudioMessages(ctx: StoryPromptContext, opts: { titles: number; thumbnails: number }): AIMessage[] {
  return [
    {
      role: "user",
      content: `Write ${opts.titles} titles and ${opts.thumbnails} thumbnail briefs for this story.\n\n${dataBlock(ctx)}`,
    },
  ];
}

/** overall = accuracy-weighted mean: an inaccurate title can't win on curiosity alone */
export function overallTitleScore(t: StudioOutput["titles"][number]): number {
  const raw = 0.25 * t.curiosity + 0.2 * t.clarity + 0.2 * t.ctr_potential + 0.35 * t.accuracy;
  return Math.round(Math.min(raw, t.accuracy + 15) * 100) / 100;
}
