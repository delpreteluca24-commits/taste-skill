import { z } from "zod";

import type { AIRouter } from "@/lib/ai/router";
import {
  blendHookScore,
  HOOK_BLEND,
  HOOK_SCORING_VERSION,
  scoreHook,
  type HookFactor,
  type HookFactorName,
  type HookScoringContext,
} from "@/lib/scoring/hook";
import type { Json } from "@/types/database";
import { buildHookMessages, HOOKS_PROMPT_VERSION, HOOKS_SYSTEM, hooksOutputSchema, type HooksOutput } from "@/prompts/hooks/generate";
import type { StoryPromptContext } from "@/prompts/script/context";

import type { AIMeta } from "./generate";
import type { HookType, ScriptAngle } from "./schema";
import { clip, normalizeForMatch } from "./text";

/**
 * Hook Studio logic (pure apart from the router call).
 *
 * SCORE = transparent heuristic (lib/scoring/hook.ts) for manual hooks, and
 *   round(0.6 × heuristic + 0.4 × AI score) for hooks written by the Hook agent
 * (HOOK_BLEND). The heuristic carries most of the weight so the model cannot
 * score a clickbait or ungrounded hook back up; the AI adds what heuristics
 * miss (relevance to the story, voice). Both parts and every factor are stored
 * in hooks.score_explanation and shown in the UI.
 */

export const MAX_HOOK_CHARS = 300;

export type HookExplanation = {
  version: string;
  method: "heuristic" | "blend";
  heuristic: { score: number; base: number; factors: HookFactor[]; unsupportedNumbers: string[] };
  ai: { score: number; rationale: string | null; model: string | null } | null;
  blend: { heuristic: number; ai: number } | null;
  /** fact ids the hook builds on (validated against the provided set) */
  factsUsed: string[];
  /** fact ids the model cited that were not provided (removed) */
  droppedFactIds: number;
  promptVersion: string | null;
};

/** Names and numbers in a hook are checked against the story's own material. */
export function hookScoringContext(ctx: StoryPromptContext): HookScoringContext {
  const o = ctx.opportunity;
  const reference = [
    ctx.story.title,
    ctx.story.logline,
    ctx.story.angle,
    o?.title,
    o?.description,
    o?.whyNow,
    o?.angle,
    o?.competition,
    ...ctx.sources.flatMap((s) => [s.title, s.publisher]),
    ...ctx.quotes.map((q) => q.speaker),
  ].filter((t): t is string => Boolean(t));
  return { facts: ctx.facts.map((f) => f.claim), reference };
}

/** Heuristic-only score (manual hooks). */
export function scoreManualHook(text: string, ctx: StoryPromptContext): { score: number; explanation: HookExplanation } {
  const h = scoreHook(text, hookScoringContext(ctx));
  return {
    score: h.score,
    explanation: {
      version: HOOK_SCORING_VERSION,
      method: "heuristic",
      heuristic: { score: h.score, base: h.base, factors: h.factors, unsupportedNumbers: h.unsupportedNumbers },
      ai: null,
      blend: null,
      factsUsed: [],
      droppedFactIds: 0,
      promptVersion: null,
    },
  };
}

/** Hook text as a viewer reads it: one line, no wrapping quotation marks. */
export function cleanHookText(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  const wrapped = /^(["“«'‘])([\s\S]*)(["”»'’])$/.exec(t);
  if (wrapped && !/["“”«»]/.test(wrapped[2])) t = wrapped[2].trim();
  return t;
}

export type GeneratedHook = {
  hookType: HookType;
  text: string;
  angle: ScriptAngle | null;
  score: number;
  explanation: HookExplanation;
};

export type HookDropCounts = {
  /** empty or longer than MAX_HOOK_CHARS */
  discarded: number;
  /** same text as an existing hook or another one in the batch */
  duplicates: number;
  /** more than requested */
  overLimit: number;
  /** fact ids that were not provided (removed from the hooks that cited them) */
  foreignFactIds: number;
};

export type SanitisedHooks = {
  hooks: GeneratedHook[];
  dropped: HookDropCounts;
  distinctTypes: number;
  missing: string[];
};

/**
 * Validate the model's hooks: clean text, drop empties / duplicates (also
 * against the story's existing hooks), keep fact ids from the provided set
 * only, prefer one hook per type, then score each one (heuristic ⊕ AI).
 */
export function sanitiseHooks(
  output: HooksOutput,
  ctx: StoryPromptContext,
  opts: { count: number; existing: readonly string[]; model: string | null; promptVersion?: string },
): SanitisedHooks {
  const dropped: HookDropCounts = { discarded: 0, duplicates: 0, overLimit: 0, foreignFactIds: 0 };
  const allowedFacts = new Set(ctx.facts.map((f) => f.id));
  const seen = new Set(opts.existing.map(normalizeForMatch).filter(Boolean));
  const scoringCtx = hookScoringContext(ctx);

  type Candidate = HooksOutput["hooks"][number] & { clean: string; facts: string[]; foreign: number };
  const candidates: Candidate[] = [];
  for (const h of output.hooks) {
    const clean = cleanHookText(h.text);
    if (!clean || clean.length > MAX_HOOK_CHARS) {
      dropped.discarded += 1;
      continue;
    }
    const key = normalizeForMatch(clean);
    if (!key || seen.has(key)) {
      dropped.duplicates += 1;
      continue;
    }
    seen.add(key);
    const facts = [...new Set(h.facts_used)].filter((id) => allowedFacts.has(id));
    const foreign = new Set(h.facts_used).size - facts.length;
    candidates.push({ ...h, clean, facts, foreign });
  }

  // one per hook type first (variety), then fill up to the requested count
  const picked: Candidate[] = [];
  const types = new Set<HookType>();
  for (const c of candidates) {
    if (picked.length < opts.count && !types.has(c.hook_type)) {
      picked.push(c);
      types.add(c.hook_type);
    }
  }
  for (const c of candidates) {
    if (picked.length >= opts.count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  dropped.overLimit = candidates.length - picked.length;

  const hooks = picked.map((c): GeneratedHook => {
    dropped.foreignFactIds += c.foreign;
    const h = scoreHook(c.clean, scoringCtx);
    const aiScore = Math.round(Math.max(0, Math.min(100, c.score)));
    return {
      hookType: c.hook_type,
      text: c.clean,
      angle: c.angle,
      score: blendHookScore(h.score, aiScore),
      explanation: {
        version: HOOK_SCORING_VERSION,
        method: "blend",
        heuristic: { score: h.score, base: h.base, factors: h.factors, unsupportedNumbers: h.unsupportedNumbers },
        ai: { score: aiScore, rationale: clip(c.rationale, 300) || null, model: opts.model },
        blend: { ...HOOK_BLEND },
        factsUsed: c.facts,
        droppedFactIds: c.foreign,
        promptVersion: opts.promptVersion ?? HOOKS_PROMPT_VERSION,
      },
    };
  });

  return {
    hooks,
    dropped,
    distinctTypes: new Set(hooks.map((h) => h.hookType)).size,
    missing: output.missing.map((m) => clip(m, 240)).filter(Boolean),
  };
}

/** One model call → sanitised, scored hooks. */
export async function generateHookSet(
  ai: AIRouter,
  ctx: StoryPromptContext,
  opts: { count: number; existing: readonly string[] },
): Promise<{ result: SanitisedHooks; meta: AIMeta }> {
  const res = await ai.generateObject(
    "script",
    { system: HOOKS_SYSTEM, messages: buildHookMessages(ctx, opts), cacheSystemPrompt: true },
    hooksOutputSchema,
  );
  const result = sanitiseHooks(res.data, ctx, { ...opts, model: res.model, promptVersion: HOOKS_PROMPT_VERSION });
  return {
    result,
    meta: { provider: res.provider, model: res.model, usage: res.usage, costUsd: res.costUsd, promptVersion: HOOKS_PROMPT_VERSION },
  };
}

/* ------------------------------------------------------------------------- */
/* read side (UI): stored explanations are never trusted blindly             */
/* ------------------------------------------------------------------------- */

const FACTOR_NAMES = [
  "length",
  "specificity",
  "curiosity_gap",
  "clarity",
  "clickbait",
  "all_caps",
  "punctuation",
  "unsupported_number",
  "unsupported_name",
  "grounded",
] as const satisfies readonly HookFactorName[];

const explanationSchema = z.object({
  version: z.string().max(40).catch("unknown"),
  method: z.enum(["heuristic", "blend"]).catch("heuristic"),
  heuristic: z.object({
    score: z.number().min(0).max(100),
    base: z.number().catch(50),
    factors: z
      .array(z.object({ name: z.enum(FACTOR_NAMES), delta: z.number(), reason: z.string().max(400) }))
      .max(20)
      .catch([]),
    unsupportedNumbers: z.array(z.string().max(40)).max(20).catch([]),
  }),
  ai: z
    .object({ score: z.number().min(0).max(100), rationale: z.string().max(600).nullable().catch(null), model: z.string().max(120).nullable().catch(null) })
    .nullable()
    .catch(null),
  blend: z.object({ heuristic: z.number(), ai: z.number() }).nullable().catch(null),
  factsUsed: z.array(z.string().max(64)).max(20).catch([]),
  droppedFactIds: z.number().int().min(0).catch(0),
  promptVersion: z.string().max(60).nullable().catch(null),
});

export function readHookExplanation(value: Json | null | undefined): HookExplanation | null {
  const parsed = explanationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
