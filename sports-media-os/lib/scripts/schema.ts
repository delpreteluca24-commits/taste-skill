import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import { SCRIPT_ANGLES, SCRIPT_TRANSFORMS } from "@/lib/jobs/types";
import { Constants } from "@/types/database";

/**
 * Script Studio & Hook Studio — constants, labels and input validation (pure;
 * shared by actions, services, the worker and the UI).
 */

export { SCRIPT_ANGLES, SCRIPT_TRANSFORMS };
export type ScriptAngle = Enums<"script_angle">;
export type ScriptOperation = Enums<"script_operation">;
export type ScriptTransform = (typeof SCRIPT_TRANSFORMS)[number];
export type HookType = Enums<"hook_type">;
export const HOOK_TYPES = Constants.public.Enums.hook_type;

/** generate pre-selects these three; the user can pick 1–5 */
export const DEFAULT_ANGLES: readonly ScriptAngle[] = ["breaking_news", "storytelling", "analysis"];
export const HOOKS_PER_RUN = 5;

export const ANGLE_LABELS: Record<ScriptAngle, { label: string; description: string }> = {
  breaking_news: { label: "Breaking news", description: "What just happened and why it matters now." },
  storytelling: { label: "Storytelling", description: "A narrative arc: protagonist, turning point, ending." },
  analysis: { label: "Analysis", description: "The why and how, explained with the facts." },
  controversy: { label: "Controversy", description: "The documented debate, both sides, fair and accurate." },
  unexpected_fact: { label: "Unexpected fact", description: "Lead with the most surprising verified fact." },
};

export const OPERATION_LABELS: Record<ScriptOperation, string> = {
  generate: "Generated",
  regenerate: "Regenerated",
  shorten: "Shortened",
  expand: "Expanded",
  rewrite_hook: "Hook rewritten",
  change_tone: "Tone changed",
  manual: "Manual edit",
};

export const TRANSFORM_LABELS: Record<ScriptTransform, { label: string; description: string }> = {
  regenerate: { label: "Regenerate", description: "A fresh take on the same angle." },
  shorten: { label: "Shorten", description: "About 40% shorter, same facts." },
  expand: { label: "Expand", description: "More depth from the facts already provided." },
  rewrite_hook: { label: "Rewrite hook", description: "New opening line; the rest stays identical." },
  change_tone: { label: "Change tone", description: "Same content in another voice." },
};

export const HOOK_TYPE_LABELS: Record<HookType, { label: string; description: string }> = {
  curiosity: { label: "Curiosity", description: "Opens a question the video answers." },
  controversial: { label: "Controversial", description: "States the documented debate — fairly." },
  shock: { label: "Shock", description: "Leads with the most surprising verified fact." },
  mystery: { label: "Mystery", description: "Withholds the key detail until the reveal." },
  story: { label: "Story", description: "Drops the viewer into a moment." },
  statistical: { label: "Statistical", description: "A number from the facts does the work." },
};

/** The six script sections, in reading order. */
export const SCRIPT_SECTIONS = [
  { key: "hook", label: "Hook", hint: "First 2–3 seconds. One honest line." },
  { key: "context", label: "Context", hint: "Who, what, when — from the facts." },
  { key: "escalation", label: "Escalation", hint: "Stakes and tension build." },
  { key: "reveal", label: "Reveal", hint: "The insight the angle hinges on." },
  { key: "payoff", label: "Payoff", hint: "Why it matters; the takeaway." },
  { key: "cta", label: "CTA", hint: "One honest call to action." },
] as const;
export type ScriptSectionKey = (typeof SCRIPT_SECTIONS)[number]["key"];
export type ScriptSections = Record<ScriptSectionKey, string>;

export function isScriptAngle(value: unknown): value is ScriptAngle {
  return typeof value === "string" && (SCRIPT_ANGLES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------- */
/* action inputs                                                             */
/* ------------------------------------------------------------------------- */

const uuid = z.uuid({ error: "Invalid id" });

export const generateScriptsSchema = z.object({
  storyId: uuid,
  angles: z
    .array(z.enum(SCRIPT_ANGLES, { error: "Unknown angle" }))
    .min(1, "Pick at least one angle")
    .max(5, "At most five angles")
    .transform((a) => [...new Set(a)]),
});

export const transformScriptSchema = z
  .object({
    scriptId: uuid,
    operation: z.enum(SCRIPT_TRANSFORMS, { error: "Unknown operation" }),
    tone: z
      .string()
      .trim()
      .max(60, "Keep the tone under 60 characters")
      .nullish()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.operation !== "change_tone" || (v.tone && v.tone.length >= 2), {
    message: "Describe the new tone (e.g. calm and analytical)",
    path: ["tone"],
  });

const sectionText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `Keep ${label.toLowerCase()} under ${max} characters`);

export const manualVersionSchema = z.object({
  storyId: uuid,
  hook: sectionText("Hook", 300),
  context: sectionText("Context", 1500),
  escalation: sectionText("Escalation", 1500),
  reveal: sectionText("Reveal", 1500),
  payoff: sectionText("Payoff", 1500),
  cta: sectionText("CTA", 300),
  tone: z
    .string()
    .trim()
    .max(60, "Keep the tone under 60 characters")
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type ManualVersionInput = z.infer<typeof manualVersionSchema>;

export const scriptDecisionSchema = z.object({
  scriptId: uuid,
  decision: z.enum(["approved", "rejected"], { error: "Pick approve or reject" }),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2000 characters")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const manualHookSchema = z.object({
  storyId: uuid,
  hookType: z.enum(HOOK_TYPES, { error: "Pick a hook type" }),
  text: z.string({ error: "Write the hook" }).trim().min(1, "Write the hook").max(300, "Keep the hook under 300 characters"),
});
export type ManualHookInput = z.infer<typeof manualHookSchema>;
