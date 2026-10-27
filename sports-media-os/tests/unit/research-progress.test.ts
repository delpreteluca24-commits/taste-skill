import { describe, expect, it } from "vitest";

import { computeProgress, researchGaps, type ProgressItem } from "@/lib/research/progress";

const item = (item_type: ProgressItem["item_type"], metadata: ProgressItem["metadata"] = {}): ProgressItem => ({
  item_type,
  metadata,
  source_id: null,
});

describe("research progress", () => {
  it("counts claims, questions and material the same way everywhere", () => {
    const p = computeProgress({
      sourceCount: 3,
      items: [
        item("question"),
        item("question", { answered: true, answer: "Orsato" }),
        item("question", { answered: "yes" }),
        item("timeline"),
        item("quote"),
        item("media"),
        item("media"),
        item("competitor"),
        item("note"),
        item("context"),
      ],
      claims: [
        { status: "confirmed", is_critical: true, supports: 1, links: 1 },
        { status: "probable", is_critical: true, supports: 1, links: 2 },
        { status: "uncertain", is_critical: false, supports: 0, links: 0 },
        { status: "false", is_critical: true, supports: 0, links: 1 },
      ],
      mediaAssets: [{ rights_status: "green", usable_in_production: true }, null],
    });
    expect(p).toEqual({
      sources: 3,
      claims: 4,
      confirmedClaims: 1,
      unconfirmedCritical: 2,
      unsourcedClaims: 1,
      falseClaims: 1,
      openQuestions: 2,
      answeredQuestions: 1,
      timeline: 1,
      quotes: 1,
      media: 2,
      mediaNotCleared: 1,
      competitors: 1,
      notes: 1,
      context: 1,
    });
  });

  it("lists READY blockers first and points each gap to its tab", () => {
    const p = computeProgress({
      sourceCount: 0,
      items: [item("media")],
      claims: [{ status: "uncertain", is_critical: true, supports: 0, links: 0 }],
      mediaAssets: [{ rights_status: "yellow", usable_in_production: false }],
    });
    const gaps = researchGaps(p);
    expect(gaps[0]).toMatchObject({ key: "unconfirmed_critical", severity: "blocker", tab: "claims" });
    expect(gaps.map((g) => g.key)).toEqual(
      expect.arrayContaining(["no_sources", "unsourced_claims", "media_not_cleared", "no_timeline", "no_competitors"]),
    );
    expect(gaps.find((g) => g.key === "media_not_cleared")?.message).toMatch(/Rights Center/);
  });

  it("no blockers when every critical claim is confirmed", () => {
    const p = computeProgress({
      sourceCount: 2,
      items: [item("timeline"), item("competitor")],
      claims: [{ status: "confirmed", is_critical: true, supports: 1, links: 1 }],
      mediaAssets: [],
    });
    expect(researchGaps(p).filter((g) => g.severity !== "info")).toEqual([]);
  });
});
