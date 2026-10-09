/**
 * OPPORTUNITY SCORE — transparent, never a black box.
 *
 *   Trend 20 · Timeliness 15 · Curiosity 15 · Originality 15 · Audience 10
 *   Competition gap 10 · Production feasibility 5 · Rights safety 5 · Monetization 5
 *
 * Every component is 0–100 and stored with its value, weight, contribution,
 * origin (heuristic / ai / manual) and a human-readable reason.
 * Missing components are NOT guessed: the score is computed over the present
 * ones (weights renormalised) and `coverage` says how much of the model was
 * actually known. Low coverage marks the score as incomplete.
 */

export const SCORING_VERSION = "opportunity-v1";

export const SCORE_COMPONENTS = [
  { key: "trend", column: "trend_score", label: "Trend", weight: 20 },
  { key: "timeliness", column: "timeliness_score", label: "Timeliness", weight: 15 },
  { key: "curiosity", column: "curiosity_score", label: "Curiosity", weight: 15 },
  { key: "originality", column: "originality_score", label: "Originality", weight: 15 },
  { key: "audience", column: "audience_score", label: "Audience", weight: 10 },
  { key: "competition_gap", column: "competition_gap_score", label: "Competition gap", weight: 10 },
  { key: "production_feasibility", column: "production_feasibility_score", label: "Production feasibility", weight: 5 },
  { key: "rights_safety", column: "rights_score", label: "Rights safety", weight: 5 },
  { key: "monetization", column: "monetization_score", label: "Monetization", weight: 5 },
] as const;

export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number]["key"];
export type ScoreColumn = (typeof SCORE_COMPONENTS)[number]["column"];
export type ComponentOrigin = "heuristic" | "ai" | "manual";

export type ComponentInput = {
  value: number | null | undefined;
  origin?: ComponentOrigin;
  reason?: string;
};

export type ComponentExplanation = {
  key: ScoreComponentKey;
  label: string;
  weight: number;
  value: number | null;
  /** points this component adds to the final 0–100 score */
  contribution: number;
  origin: ComponentOrigin | null;
  reason: string;
};

export type OpportunityScore = {
  score: number | null;
  /** % of total weight that had a value (100 = fully scored) */
  coverage: number;
  complete: boolean;
  incomplete: boolean;
  version: string;
  components: ComponentExplanation[];
  missing: ScoreComponentKey[];
  summary: string;
};

/** below this coverage the score is shown as incomplete and never auto-promoted */
export const MIN_COVERAGE = 70;

const TOTAL_WEIGHT = SCORE_COMPONENTS.reduce((s, c) => s + c.weight, 0); // 100

function clamp(v: number) {
  return Math.min(100, Math.max(0, v));
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function computeOpportunityScore(inputs: Partial<Record<ScoreComponentKey, ComponentInput>>): OpportunityScore {
  const present = SCORE_COMPONENTS.filter((c) => {
    const v = inputs[c.key]?.value;
    return typeof v === "number" && Number.isFinite(v);
  });
  const presentWeight = present.reduce((s, c) => s + c.weight, 0);
  const coverage = round2((presentWeight / TOTAL_WEIGHT) * 100);

  const components: ComponentExplanation[] = SCORE_COMPONENTS.map((c) => {
    const input = inputs[c.key];
    const raw = input?.value;
    const value = typeof raw === "number" && Number.isFinite(raw) ? round2(clamp(raw)) : null;
    const contribution = value === null || presentWeight === 0 ? 0 : round2((value * c.weight) / presentWeight);
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      value,
      contribution,
      origin: value === null ? null : (input?.origin ?? "manual"),
      reason: value === null ? "Not scored yet" : (input?.reason?.trim() || "No reason recorded"),
    };
  });

  // total from exact weighted values (display contributions are rounded individually)
  const exact = present.reduce((sum, c) => sum + clamp(inputs[c.key]!.value as number) * c.weight, 0);
  const score = presentWeight === 0 ? null : round2(exact / presentWeight);
  const missing = components.filter((c) => c.value === null).map((c) => c.key);
  const incomplete = coverage < MIN_COVERAGE;

  const top = [...components]
    .filter((c) => c.value !== null)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((c) => `${c.label} ${c.value}`);
  const summary =
    score === null
      ? "No component scored yet."
      : `${score}/100 from ${present.length}/${SCORE_COMPONENTS.length} components (coverage ${coverage}%). ` +
        `Main drivers: ${top.join(", ")}.` +
        (missing.length ? ` Missing: ${missing.join(", ")}.` : "");

  return {
    score,
    coverage,
    complete: missing.length === 0,
    incomplete,
    version: SCORING_VERSION,
    components,
    missing,
    summary,
  };
}

/** Columns to write on `opportunities` for a computed score (components + total + explanation). */
export function scoreToColumns(
  inputs: Partial<Record<ScoreComponentKey, ComponentInput>>,
  result: OpportunityScore = computeOpportunityScore(inputs),
) {
  const cols: Record<string, unknown> = {
    opportunity_score: result.score,
    score_coverage: result.coverage,
    scoring_version: result.version,
    score_explanation: { summary: result.summary, components: result.components, missing: result.missing },
    scored_at: new Date().toISOString(),
  };
  for (const c of SCORE_COMPONENTS) cols[c.column] = result.components.find((x) => x.key === c.key)?.value ?? null;
  return cols;
}

/** Rebuild inputs from a stored opportunity row (+ its explanation) to rescore after one change. */
export function inputsFromRow(row: Partial<Record<ScoreColumn, number | string | null>> & { score_explanation?: unknown }) {
  const explained = new Map<string, ComponentExplanation>();
  const exp = row.score_explanation as { components?: ComponentExplanation[] } | null | undefined;
  for (const c of exp?.components ?? []) explained.set(c.key, c);
  const inputs: Partial<Record<ScoreComponentKey, ComponentInput>> = {};
  for (const c of SCORE_COMPONENTS) {
    const raw = row[c.column];
    const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    const prev = explained.get(c.key);
    inputs[c.key] = { value, origin: prev?.origin ?? undefined, reason: prev?.reason };
  }
  return inputs;
}
