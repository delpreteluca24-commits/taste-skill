import type { AIRouter } from "@/lib/ai/router";
import type { AIProviderId, AIUsage } from "@/lib/ai/types";
import type { Tables } from "@/lib/db/client";
import {
  AI_SCORED_COMPONENTS,
  buildOpportunityScoringMessages,
  MAX_SOURCES_IN_PROMPT,
  OPPORTUNITY_SCORING_SYSTEM,
  opportunityScoringOutputSchema,
  type AIScoredComponent,
  type OpportunityScoringInput,
  type OpportunityScoringOutput,
} from "@/prompts/scoring/opportunity";

import { applyAIComponents, buildScoreColumns, readRow, type AIComponentValue } from "./scoring";

/**
 * AI refinement of curiosity / originality / audience / monetization.
 * Runs in the worker only (never in a web request). Pure apart from the router
 * call, so it is unit-tested with a fake router.
 */

export type ScoringRow = Pick<
  Tables<"opportunities">,
  | "id"
  | "title"
  | "description"
  | "why_now"
  | "angle"
  | "hook"
  | "competition"
  | "signals"
  | "competition_level"
  | "trend_score"
  | "timeliness_score"
  | "curiosity_score"
  | "originality_score"
  | "audience_score"
  | "competition_gap_score"
  | "production_feasibility_score"
  | "rights_score"
  | "monetization_score"
  | "score_explanation"
>;

export type ScoringSource = { id: string; title: string; publisher: string | null };
export type ScoringContext = { sportName: string | null; sources: ScoringSource[] };

/** AI components a human already set: never sent for scoring, never overwritten. */
export function manualAIComponents(row: ScoringRow): AIScoredComponent[] {
  const { inputs } = readRow(row);
  return AI_SCORED_COMPONENTS.filter((k) => {
    const c = inputs[k];
    return typeof c?.value === "number" && (c.origin ?? "manual") === "manual";
  });
}

export function buildScoringInput(row: ScoringRow, ctx: ScoringContext): OpportunityScoringInput {
  return {
    opportunity: {
      id: row.id,
      title: row.title,
      description: row.description,
      why_now: row.why_now,
      angle: row.angle,
      hook: row.hook,
      competition: row.competition,
      sport: ctx.sportName,
      signals: row.signals ?? [],
      competition_level: row.competition_level,
    },
    sources: ctx.sources.slice(0, MAX_SOURCES_IN_PROMPT),
    doNotScore: manualAIComponents(row),
  };
}

/** The exact request the worker sends (also used to estimate cost before enqueueing). */
export function buildScoringRequest(row: ScoringRow, ctx: ScoringContext) {
  const input = buildScoringInput(row, ctx);
  return {
    input,
    request: { system: OPPORTUNITY_SCORING_SYSTEM, messages: buildOpportunityScoringMessages(input), cacheSystemPrompt: true },
  };
}

export type RejectedComponent = {
  component: string;
  /** manual = protected human value (expected); the others point at a problem in the model output */
  code: "manual" | "unknown_source" | "duplicate" | "not_allowed";
  why: string;
};

/**
 * Validate model output against what we provided: allowed components only,
 * no manual components, one value per component, and every cited source id
 * must be one we sent. A component citing an unknown source is rejected (its
 * reason may rest on invented material).
 */
export function validateScoringOutput(
  output: OpportunityScoringOutput,
  provided: { sourceIds: string[]; doNotScore: AIScoredComponent[] },
): { accepted: AIComponentValue[]; rejected: RejectedComponent[] } {
  const allowedSources = new Set(provided.sourceIds);
  const accepted: AIComponentValue[] = [];
  const rejected: RejectedComponent[] = [];
  for (const c of output.components) {
    if (!(AI_SCORED_COMPONENTS as readonly string[]).includes(c.component)) {
      rejected.push({ component: c.component, code: "not_allowed", why: "not an AI-scored component" });
    } else if (provided.doNotScore.includes(c.component)) {
      rejected.push({ component: c.component, code: "manual", why: "set manually by a human" });
    } else if (accepted.some((a) => a.component === c.component)) {
      rejected.push({ component: c.component, code: "duplicate", why: "duplicate value" });
    } else {
      const unknown = (c.source_ids ?? []).filter((id) => !allowedSources.has(id));
      if (unknown.length > 0) {
        rejected.push({ component: c.component, code: "unknown_source", why: `cites ${unknown.length} source id(s) that were not provided` });
      } else {
        accepted.push({ component: c.component, value: c.value, reason: c.reason });
      }
    }
  }
  return { accepted, rejected };
}

export type AIScoreResult = {
  accepted: AIComponentValue[];
  rejected: RejectedComponent[];
  provider: AIProviderId;
  model: string;
  usage: AIUsage;
  costUsd: number | null;
};

/** One model call for one opportunity. Returns null when every AI component is manual (no call, no cost). */
export async function requestAIScores(router: AIRouter, row: ScoringRow, ctx: ScoringContext): Promise<AIScoreResult | null> {
  const { input, request } = buildScoringRequest(row, ctx);
  if (input.doNotScore.length === AI_SCORED_COMPONENTS.length) return null;
  const res = await router.generateObject("scoring", request, opportunityScoringOutputSchema);
  const { accepted, rejected } = validateScoringOutput(res.data, {
    sourceIds: input.sources.map((s) => s.id),
    doNotScore: input.doNotScore,
  });
  return { accepted, rejected, provider: res.provider, model: res.model, usage: res.usage, costUsd: res.costUsd };
}

/**
 * Apply accepted AI values onto the CURRENT row (re-read just before writing,
 * so a manual change made during the call still wins) and recompute the score.
 */
export function applyAIScores(row: ScoringRow, accepted: AIComponentValue[]) {
  const { inputs, notes } = readRow(row);
  const result = applyAIComponents(inputs, accepted);
  return { columns: buildScoreColumns(result.inputs, notes), applied: result.applied, keptManual: result.keptManual };
}
