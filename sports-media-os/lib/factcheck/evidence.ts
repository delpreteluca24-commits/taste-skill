import type { ClaimRelation } from "./presentation";

/**
 * Evidence summary for one claim (pure): how many linked sources support,
 * contradict or merely mention it, and whether a person may confirm it.
 * canConfirm mirrors the DB rule (facts_confirmation_guard): a CRITICAL claim
 * needs at least one 'supports' source; non-critical claims have no minimum.
 */

export type EvidenceVerdict = "unsourced" | "mentioned_only" | "supported" | "contested" | "contradicted";

export type EvidenceSummary = {
  supports: number;
  contradicts: number;
  mentions: number;
  total: number;
  verdict: EvidenceVerdict;
  label: string;
  /** what the producer should do next, in one line */
  hint: string;
  /** a person may set status 'confirmed' (the DB enforces the same rule) */
  canConfirm: boolean;
};

const LABELS: Record<EvidenceVerdict, string> = {
  unsourced: "No sources",
  mentioned_only: "Mentioned only",
  supported: "Supported",
  contested: "Contested",
  contradicted: "Contradicted",
};

export function summariseEvidence(links: readonly { relation: ClaimRelation }[], isCritical: boolean): EvidenceSummary {
  let supports = 0;
  let contradicts = 0;
  let mentions = 0;
  for (const l of links) {
    if (l.relation === "supports") supports += 1;
    else if (l.relation === "contradicts") contradicts += 1;
    else mentions += 1;
  }
  const total = supports + contradicts + mentions;

  let verdict: EvidenceVerdict;
  if (total === 0) verdict = "unsourced";
  else if (supports > 0 && contradicts > 0) verdict = "contested";
  else if (supports > 0) verdict = "supported";
  else if (contradicts > 0) verdict = "contradicted";
  else verdict = "mentioned_only";

  const canConfirm = !isCritical || supports > 0;
  const hint = {
    unsourced: isCritical
      ? "Link a source that states this claim before it can be confirmed."
      : "Link a source so the claim can be checked.",
    mentioned_only: isCritical
      ? "Sources only mention it: link one that states it (Supports) to confirm."
      : "Sources only mention it: find one that states it.",
    supported: contradicts === 0 ? "Supporting evidence on file: a person can confirm it." : "",
    contested: "Sources disagree: resolve the contradiction before confirming.",
    contradicted: "Sources contradict it: consider marking it False.",
  }[verdict];

  return { supports, contradicts, mentions, total, verdict, label: LABELS[verdict], hint, canConfirm };
}
