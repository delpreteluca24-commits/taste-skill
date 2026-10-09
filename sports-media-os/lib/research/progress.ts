import type { Enums } from "@/lib/db/client";
import type { Json } from "@/types/database";

import { readItemMeta, type ResearchItemType } from "./schema";

/**
 * Research progress and gaps (pure): what is on hand for an opportunity and
 * what is still missing before scripting. Used by the research list and the
 * workspace overview so both always count the same way.
 */

export type ProgressItem = { item_type: ResearchItemType; metadata: Json; source_id: string | null };
export type ProgressClaim = {
  status: Enums<"fact_status">;
  is_critical: boolean;
  /** linked sources by relation */
  supports: number;
  links: number;
};
export type ProgressMediaAsset = { rights_status: Enums<"rights_status">; usable_in_production: boolean };

export type ResearchProgress = {
  sources: number;
  claims: number;
  confirmedClaims: number;
  /** critical claims not confirmed yet: each one blocks READY */
  unconfirmedCritical: number;
  /** claims without any linked source */
  unsourcedClaims: number;
  falseClaims: number;
  openQuestions: number;
  answeredQuestions: number;
  timeline: number;
  quotes: number;
  media: number;
  /** media assets not cleared for production (unchecked, RED or unapproved YELLOW) */
  mediaNotCleared: number;
  competitors: number;
  notes: number;
  context: number;
};

export function computeProgress(input: {
  sourceCount: number;
  items: readonly ProgressItem[];
  claims: readonly ProgressClaim[];
  /** rights of the assets referenced by media items (missing source = not cleared) */
  mediaAssets: readonly (ProgressMediaAsset | null)[];
}): ResearchProgress {
  const count = (t: ResearchItemType) => input.items.filter((i) => i.item_type === t).length;
  const questions = input.items.filter((i) => i.item_type === "question");
  const answered = questions.filter((q) => readItemMeta(q.metadata).answered).length;

  return {
    sources: input.sourceCount,
    claims: input.claims.length,
    confirmedClaims: input.claims.filter((c) => c.status === "confirmed").length,
    unconfirmedCritical: input.claims.filter((c) => c.is_critical && c.status !== "confirmed").length,
    unsourcedClaims: input.claims.filter((c) => c.links === 0).length,
    falseClaims: input.claims.filter((c) => c.status === "false").length,
    openQuestions: questions.length - answered,
    answeredQuestions: answered,
    timeline: count("timeline"),
    quotes: count("quote"),
    media: count("media"),
    mediaNotCleared: input.mediaAssets.filter((a) => !a || !a.usable_in_production).length,
    competitors: count("competitor"),
    notes: count("note"),
    context: count("context"),
  };
}

export type GapSeverity = "blocker" | "warning" | "info";
export type ResearchGap = {
  key: string;
  severity: GapSeverity;
  message: string;
  /** workspace tab that fixes it */
  tab: "sources" | "claims" | "timeline" | "quotes" | "media" | "competitors" | "questions" | "notes";
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ordered: READY blockers first, then what weakens the story, then nice-to-haves. */
export function researchGaps(p: ResearchProgress): ResearchGap[] {
  const gaps: ResearchGap[] = [];
  if (p.unconfirmedCritical > 0) {
    gaps.push({
      key: "unconfirmed_critical",
      severity: "blocker",
      message: `${plural(p.unconfirmedCritical, "critical claim")} not confirmed — content cannot reach READY until a person confirms ${p.unconfirmedCritical === 1 ? "it" : "them"} against a supporting source.`,
      tab: "claims",
    });
  }
  if (p.sources === 0) {
    gaps.push({ key: "no_sources", severity: "warning", message: "No sources yet: add the articles and official pages the story relies on.", tab: "sources" });
  }
  if (p.unsourcedClaims > 0) {
    gaps.push({ key: "unsourced_claims", severity: "warning", message: `${plural(p.unsourcedClaims, "claim")} without any linked source.`, tab: "claims" });
  }
  if (p.falseClaims > 0) {
    gaps.push({ key: "false_claims", severity: "warning", message: `${plural(p.falseClaims, "claim")} marked False: keep them out of the script.`, tab: "claims" });
  }
  if (p.mediaNotCleared > 0) {
    gaps.push({
      key: "media_not_cleared",
      severity: "warning",
      message: `${plural(p.mediaNotCleared, "media asset")} not cleared for production: classify ${p.mediaNotCleared === 1 ? "it" : "them"} in the Rights Center, or use original formats.`,
      tab: "media",
    });
  }
  if (p.openQuestions > 0) {
    gaps.push({ key: "open_questions", severity: "info", message: `${plural(p.openQuestions, "open question")}.`, tab: "questions" });
  }
  if (p.claims === 0) {
    gaps.push({ key: "no_claims", severity: "info", message: "No claims listed yet: write down the facts the story depends on.", tab: "claims" });
  }
  if (p.timeline === 0) {
    gaps.push({ key: "no_timeline", severity: "info", message: "No timeline yet: dated events make graphics and voiceover easier.", tab: "timeline" });
  }
  if (p.competitors === 0) {
    gaps.push({ key: "no_competitors", severity: "info", message: "No competitor videos logged: check what is already out there before choosing the angle.", tab: "competitors" });
  }
  return gaps;
}
