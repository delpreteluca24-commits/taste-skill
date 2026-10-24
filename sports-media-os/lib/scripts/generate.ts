import type { AIRouter } from "@/lib/ai/router";
import type { AIProviderId, AIUsage } from "@/lib/ai/types";
import { buildAngleMessages, SCRIPT_PROMPT_VERSION, SCRIPT_SYSTEM, scriptOutputSchema, type ScriptOutput } from "@/prompts/script/angles";
import type { StoryPromptContext } from "@/prompts/script/context";
import {
  buildTransformMessages,
  SCRIPT_TRANSFORM_PROMPT_VERSION,
  SCRIPT_TRANSFORM_SYSTEM,
  type TransformParent,
} from "@/prompts/script/transform";

import {
  composeFullText,
  estimateDurationSec,
  formatWarning,
  groundScript,
  MAX_WARNINGS,
  type GroundingFact,
  type GroundingQuote,
  type GroundingResult,
  type ScriptWarning,
} from "./grounding";
import { SCRIPT_SECTIONS, type ScriptAngle, type ScriptSectionKey, type ScriptSections, type ScriptTransform } from "./schema";
import { wordCount } from "./text";

/**
 * Script generation (SCRIPT task) — request + grounding, pure apart from the
 * router call, so the worker handlers stay thin and this is unit-testable with
 * a fake router. NEVER INVENT FACTS: every draft is grounded against the exact
 * material the model was shown (the same limited StoryPromptContext).
 */

/** per-section caps (same as the manual editor) */
export const SECTION_LIMITS: Record<ScriptSectionKey, number> = {
  hook: 300,
  context: 1500,
  escalation: 1500,
  reveal: 1500,
  payoff: 1500,
  cta: 300,
};

/** A version ready to insert (scripts row minus ids / lineage). */
export type DraftVersion = {
  angle: ScriptAngle | null;
  sections: ScriptSections;
  fullText: string;
  wordCount: number;
  targetDurationSec: number | null;
  factsUsed: string[];
  warnings: string[];
  checks: GroundingResult["checks"];
};

export type AIMeta = {
  provider: AIProviderId;
  model: string;
  usage: AIUsage;
  costUsd: number | null;
  promptVersion: string;
};

/** What grounding checks against: the facts and quotes in the context (after limitContext). */
export function groundingMaterial(ctx: StoryPromptContext): { facts: GroundingFact[]; quotes: GroundingQuote[] } {
  return {
    facts: ctx.facts.map((f) => ({ id: f.id, claim: f.claim, status: f.status })),
    quotes: ctx.quotes.map((q) => ({ id: q.id, text: q.text, speaker: q.speaker })),
  };
}

/** Whitespace collapsed inside lines, capped to the section limit (never silently empty). */
function cleanSection(text: string, max: number): string {
  const t = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function sectionsFromOutput(out: Pick<ScriptOutput, ScriptSectionKey>): ScriptSections {
  return Object.fromEntries(SCRIPT_SECTIONS.map((s) => [s.key, out[s.key] ?? ""])) as ScriptSections;
}

/**
 * Clean the sections, ground them and compute the derived fields.
 * Used for AI drafts and manual versions alike.
 */
export function buildDraft(
  ctx: StoryPromptContext,
  input: {
    angle: ScriptAngle | null;
    sections: ScriptSections;
    factIds: readonly string[];
    quoteIds?: readonly string[];
    missing?: readonly string[];
  },
): DraftVersion {
  const sections = Object.fromEntries(
    SCRIPT_SECTIONS.map((s) => [s.key, cleanSection(input.sections[s.key] ?? "", SECTION_LIMITS[s.key])]),
  ) as ScriptSections;

  const grounding = groundScript({
    sections,
    factIds: input.factIds,
    quoteIds: input.quoteIds,
    missing: input.missing,
    ...groundingMaterial(ctx),
  });

  const empty = SCRIPT_SECTIONS.filter((s) => !sections[s.key]).map((s) => s.label);
  const extra: ScriptWarning[] = empty.length
    ? [{ kind: "empty_section", message: `${empty.join(", ")} ${empty.length === 1 ? "is" : "are"} empty. Write ${empty.length === 1 ? "it" : "them"} before approving.` }]
    : [];

  const fullText = composeFullText(sections);
  const words = wordCount(fullText);
  return {
    angle: input.angle,
    sections,
    fullText,
    wordCount: words,
    targetDurationSec: estimateDurationSec(words),
    factsUsed: grounding.factsUsed,
    warnings: [...extra.map(formatWarning), ...grounding.warnings].slice(0, MAX_WARNINGS),
    checks: grounding.checks,
  };
}

function metaOf(res: { provider: AIProviderId; model: string; usage: AIUsage; costUsd: number | null }, promptVersion: string): AIMeta {
  return { provider: res.provider, model: res.model, usage: res.usage, costUsd: res.costUsd, promptVersion };
}

/** One angle → one grounded draft (one model call). */
export async function generateAngleDraft(
  ai: AIRouter,
  ctx: StoryPromptContext,
  angle: ScriptAngle,
): Promise<{ draft: DraftVersion; meta: AIMeta }> {
  const res = await ai.generateObject(
    "script",
    { system: SCRIPT_SYSTEM, messages: buildAngleMessages(ctx, angle), cacheSystemPrompt: true },
    scriptOutputSchema,
  );
  const out = res.data;
  const draft = buildDraft(ctx, {
    angle,
    sections: sectionsFromOutput(out),
    factIds: out.facts_used,
    quoteIds: out.quote_ids,
    missing: out.missing,
  });
  return { draft, meta: metaOf(res, SCRIPT_PROMPT_VERSION) };
}

/**
 * A new version derived from `parent`. rewrite_hook keeps the parent's other
 * five sections VERBATIM whatever the model returns (only the hook changes).
 */
export async function transformDraft(
  ai: AIRouter,
  ctx: StoryPromptContext,
  parent: TransformParent,
  operation: ScriptTransform,
  tone?: string | null,
): Promise<{ draft: DraftVersion; meta: AIMeta }> {
  const res = await ai.generateObject(
    "script",
    {
      system: SCRIPT_TRANSFORM_SYSTEM,
      messages: buildTransformMessages(ctx, parent, operation, tone),
      cacheSystemPrompt: true,
    },
    scriptOutputSchema,
  );
  const out = res.data;
  const sections = operation === "rewrite_hook" ? { ...parent.sections, hook: out.hook } : sectionsFromOutput(out);
  const factIds = operation === "rewrite_hook" ? [...parent.factsUsed, ...out.facts_used] : out.facts_used;
  const draft = buildDraft(ctx, {
    angle: parent.angle,
    sections,
    factIds,
    quoteIds: out.quote_ids,
    missing: out.missing,
  });
  return { draft, meta: metaOf(res, SCRIPT_TRANSFORM_PROMPT_VERSION) };
}

/** Totals over several model calls of one job (agent run tokens and cost). */
export function summariseUsage(metas: readonly AIMeta[]): {
  provider: AIProviderId | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  /** null when no call had a known price */
  costUsd: number | null;
} {
  const priced = metas.filter((m) => m.costUsd !== null);
  const last = metas.at(-1) ?? null;
  return {
    provider: last?.provider ?? null,
    model: last?.model ?? null,
    tokensIn: metas.reduce((n, m) => n + m.usage.inputTokens + m.usage.cacheReadTokens + m.usage.cacheWriteTokens, 0),
    tokensOut: metas.reduce((n, m) => n + m.usage.outputTokens, 0),
    costUsd: priced.length ? Math.round(priced.reduce((n, m) => n + (m.costUsd ?? 0), 0) * 1e6) / 1e6 : null,
  };
}
