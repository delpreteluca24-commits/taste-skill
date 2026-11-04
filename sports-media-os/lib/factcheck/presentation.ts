import type { Enums } from "@/lib/db/client";

/**
 * Fact-check presentation (pure): labels, badge variants and help text for
 * claim statuses, source relations and confidence. Icons are mapped in
 * components/research/badges.tsx — status is always icon + label, never color alone.
 */

export type FactStatus = Enums<"fact_status">;
export type ClaimRelation = Enums<"claim_relation">;
export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

export const FACT_STATUS_VIEW: Record<FactStatus, { label: string; variant: BadgeVariant; description: string }> = {
  confirmed: {
    label: "Confirmed",
    variant: "success",
    description: "Verified by a person against at least one supporting source.",
  },
  probable: {
    label: "Probable",
    variant: "info",
    description: "Likely true, but not fully verified. Critical claims block READY until confirmed.",
  },
  uncertain: {
    label: "Uncertain",
    variant: "warning",
    description: "Not verified yet. Every new and AI-suggested claim starts here.",
  },
  false: {
    label: "False",
    variant: "danger",
    description: "Contradicted by the sources. Do not use it as a fact.",
  },
};

/** Order used in status pickers: the most common human outcomes first. */
export const FACT_STATUS_ORDER: readonly FactStatus[] = ["confirmed", "probable", "uncertain", "false"];

export const RELATION_VIEW: Record<ClaimRelation, { label: string; variant: BadgeVariant; description: string }> = {
  supports: { label: "Supports", variant: "success", description: "The source states the claim." },
  contradicts: { label: "Contradicts", variant: "danger", description: "The source states the opposite." },
  mentions: { label: "Mentions", variant: "outline", description: "Related, but neither confirms nor refutes it." },
};

export type ConfidenceBand = "high" | "medium" | "low" | "none";

export function confidenceBand(confidence: number | null | undefined): ConfidenceBand {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return "none";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

/** 0.856 → "86%"; missing stays visibly missing ("—"), never 0%. */
export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return "—";
  const clamped = Math.min(1, Math.max(0, confidence));
  return `${Math.round(clamped * 100)}%`;
}

export const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
  none: "not assessed",
};

/** Who last changed the verification state (DB-stamped, never client-supplied). */
export function describeChecker(input: {
  checkedByName: string | null;
  checkedBy: string | null;
  checkedByAgent: string | null;
}): string {
  if (input.checkedByAgent === "researcher") return "Researcher agent (suggestion)";
  if (input.checkedByAgent === "fact_checker") return "Fact Checker agent (suggestion)";
  if (input.checkedByAgent) return `${input.checkedByAgent.replace(/_/g, " ")} agent`;
  if (input.checkedByName) return input.checkedByName;
  if (input.checkedBy) return "a team member";
  return "—";
}
