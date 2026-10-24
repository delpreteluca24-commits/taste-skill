import { z } from "zod";

import type { AIMessage } from "@/lib/ai/types";
import { HOOK_TYPES, SCRIPT_ANGLES, type HookType } from "@/lib/scripts/schema";

import { dataBlock, GROUND_RULES, type StoryPromptContext } from "../script/context";

/**
 * SCRIPT task (lib/ai/models.ts → "script"), Hook agent: opening hooks for one
 * story across the six hook types, each with the model's own 0–100 score.
 *
 * The model sees ONLY the story data block (facts with ids, sources, quotes,
 * production formats). The worker then validates fact ids, drops duplicates and
 * blends the model's score with the transparent heuristic (lib/scoring/hook.ts),
 * so a clickbait hook can't be scored back up by the model.
 */

export const HOOKS_PROMPT_VERSION = "hooks-generate-v1";

export const HOOK_TYPE_BRIEFS: Record<HookType, string> = {
  curiosity: "curiosity — opens a question the video answers (not one it can't).",
  controversial: "controversial — states the DOCUMENTED debate fairly; no accusation, no invented outrage. Skip it if the facts show no real debate.",
  shock: "shock — leads with the most surprising LISTED fact (prefer a confirmed one); the surprise must be real, not sensational wording.",
  mystery: "mystery — withholds the key detail until the reveal; the detail must be in the facts.",
  story: "story — drops the viewer into a moment the facts describe.",
  statistical: "statistical — a number from a listed fact claim does the work. Skip it if no fact contains a number.",
};

export const HOOKS_SYSTEM = `You write opening hooks for ORIGINAL short-form sports videos (YouTube Shorts, TikTok, Instagram Reels) for a rights-first sports media team. A hook is the first 2–3 seconds: it decides whether the viewer stays.

Hook types:
${HOOK_TYPES.map((t) => `- ${HOOK_TYPE_BRIEFS[t]}`).join("\n")}

Every hook:
- one sentence, 6–14 words, plain words, no ALL CAPS, no "!!" or "?!";
- honest: the video can deliver exactly what it promises;
- built only from the data block: names and numbers must appear in a listed fact claim; put those facts' ids in facts_used;
- angle: the script angle it fits best (breaking_news, storytelling, analysis, controversy, unexpected_fact) or null.

Score each hook 0–100 for how well it would hold a viewer honestly AND fit this story, and give a one-sentence rationale. Do not reward hype: a hook that over-promises scores low.

${GROUND_RULES}

Answer with JSON only:
{"hooks":[{"hook_type":"curiosity","text":"...","angle":"analysis","facts_used":["<fact id>"],"score":72,"rationale":"..."}],"missing":["what research would make stronger hooks possible"]}`;

export function buildHookMessages(ctx: StoryPromptContext, opts: { count: number; existing: readonly string[] }): AIMessage[] {
  const existing = opts.existing.slice(0, 20);
  return [
    {
      role: "user",
      content: `Write ${opts.count} hooks for this story, each of a DIFFERENT hook type where the facts allow it (${HOOK_TYPES.join(", ")}).${
        existing.length
          ? `\nThese hooks already exist; do not repeat or lightly reword them:\n${existing.map((h) => `- ${JSON.stringify(h)}`).join("\n")}`
          : ""
      }\n\n${dataBlock(ctx)}`,
    },
  ];
}

/**
 * Output contract. Permissive on lengths (the sanitiser trims, dedupes and
 * drops empties) but strict on the enums the database stores.
 */
export const hooksOutputSchema = z.object({
  hooks: z
    .array(
      z.object({
        hook_type: z.enum(HOOK_TYPES),
        text: z.string().max(500),
        angle: z.enum(SCRIPT_ANGLES).nullable(),
        facts_used: z.array(z.string().max(64)).max(20),
        score: z.number().min(0).max(100),
        rationale: z.string().max(600),
      }),
    )
    .max(15),
  missing: z.array(z.string().max(300)).max(10),
});
export type HooksOutput = z.infer<typeof hooksOutputSchema>;
