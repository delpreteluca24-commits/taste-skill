import { z } from "zod";

import type { AIMessage } from "@/lib/ai/types";
import { ANGLE_LABELS, type ScriptAngle } from "@/lib/scripts/schema";

import { dataBlock, GROUND_RULES, type StoryPromptContext } from "./context";

/**
 * SCRIPT task (lib/ai/models.ts → "script"): one script per editorial angle
 * for a short-form video (YouTube Shorts, TikTok, Reels), written ONLY from the
 * story's research. Output is validated by scriptOutputSchema and then grounded
 * (lib/scripts/grounding.ts) before it is stored as an immutable version.
 */

export const SCRIPT_PROMPT_VERSION = "script-angles-v1";

/** what each angle asks of the writer */
export const ANGLE_BRIEFS: Record<ScriptAngle, string> = {
  breaking_news:
    "Breaking news: the fastest clear path to what just happened and why it matters right now. Neutral, precise, no opinion. Lead with the most important confirmed fact.",
  storytelling:
    "Storytelling: a narrative arc built from the facts — a protagonist, a turning point, an ending. Chronology only as far as the facts establish it.",
  analysis:
    "Analysis: explain the why and the how (tactics, form, context) using the facts; show the reasoning so the viewer can follow it. Opinions are clearly ours and based on the listed facts.",
  controversy:
    "Controversy: the documented debate. Present each side fairly with its source, no accusations, no speculation about motives; end by letting the viewer weigh in. If the facts show no real debate, say what is known and do not manufacture one.",
  unexpected_fact:
    "Unexpected fact: open with the most surprising LISTED fact (prefer a confirmed one), then the context that makes it surprising, then why it matters.",
};

export const SCRIPT_SYSTEM = `You write scripts for ORIGINAL short-form sports videos (YouTube Shorts, TikTok, Instagram Reels) for a rights-first sports media team. The team never reposts highlights: its videos are commentary, analysis, graphics and voiceover built on verified research.

Script structure (30–60 seconds, about 90–150 spoken words in total):
- hook: the first 2–3 seconds. One sentence of 6–14 words that earns attention honestly; the video must deliver what it promises.
- context: who, what, when — one or two sentences from the facts.
- escalation: the stakes and tension build.
- reveal: the insight or fact the angle hinges on.
- payoff: why it matters; the takeaway.
- cta: one honest call to action (follow, or a genuine opinion question for the comments). No fake urgency, no engagement bait.

${GROUND_RULES}

Answer with JSON only:
{"hook":"...","context":"...","escalation":"...","reveal":"...","payoff":"...","cta":"...","facts_used":["<fact id>"],"quote_ids":["<quote id>"],"missing":["what research is missing, as a short to-do"]}`;

export function buildAngleMessages(ctx: StoryPromptContext, angle: ScriptAngle): AIMessage[] {
  return [
    {
      role: "user",
      content: `Write the "${ANGLE_LABELS[angle].label}" angle for this story.\nAngle brief: ${ANGLE_BRIEFS[angle]}\n\n${dataBlock(ctx)}`,
    },
  ];
}

const section = (max: number) => z.string().trim().min(1).max(max);

/** shared by generate and transform: the six sections + what the model says it used */
export const scriptOutputSchema = z.object({
  hook: section(300),
  context: section(1500),
  escalation: section(1500),
  reveal: section(1500),
  payoff: section(1500),
  cta: section(300),
  facts_used: z.array(z.string().max(64)).max(60),
  quote_ids: z.array(z.string().max(64)).max(20),
  missing: z.array(z.string().trim().max(300)).max(10),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;
