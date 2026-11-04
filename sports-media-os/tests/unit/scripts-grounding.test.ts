import { describe, expect, it } from "vitest";

import {
  composeFullText,
  estimateDurationSec,
  formatWarning,
  groundScript,
  MAX_WARNINGS,
  parseWarning,
  type GroundingFact,
  type GroundingQuote,
} from "@/lib/scripts/grounding";
import type { ScriptSections } from "@/lib/scripts/schema";
import { canonicalNumber, extractNumbers, extractQuotations } from "@/lib/scripts/text";

/**
 * NEVER INVENT FACTS: what the AI (or a person) writes is checked against the
 * research it was written from. Nothing is rewritten silently — the version
 * keeps its text and the warnings say what a reviewer must check.
 */

const facts: GroundingFact[] = [
  { id: "f-score", claim: "Bologna beat Inter 3-0 at San Siro on 4 October 2026", status: "confirmed" },
  { id: "f-brace", claim: "Orsolini scored twice in the second half", status: "probable" },
  { id: "f-coach", claim: "Inter's coach is under pressure after the defeat", status: "uncertain" },
];
const quotes: GroundingQuote[] = [{ id: "q-1", text: "We pressed them like never before, and it worked.", speaker: "Italiano" }];

const clean: ScriptSections = {
  hook: "Bologna won 3-0 at San Siro.",
  context: "On 4 October 2026, Inter lost at home.",
  escalation: "The visitors pressed high from the first minute.",
  reveal: "Italiano put it simply: “We pressed them like never before”.",
  payoff: "A blueprint other sides will copy.",
  cta: "Follow for the tactical breakdown.",
};

const kinds = (warnings: string[]) => warnings.map((w) => parseWarning(w).kind);

describe("groundScript — fact ids", () => {
  it("keeps only provided fact ids (deduplicated) and warns about the rest", () => {
    const r = groundScript({ sections: clean, factIds: ["f-score", "invented-1", "f-score", "invented-2"], facts, quotes });
    expect(r.factsUsed).toEqual(["f-score"]);
    expect(r.checks.droppedFactIds).toEqual(["invented-1", "invented-2"]);
    expect(kinds(r.warnings)).toContain("unknown_fact");
    expect(r.warnings.join(" ")).toMatch(/Removed 2 fact reference/);
  });

  it("drops quote ids that are not research quotes", () => {
    const r = groundScript({ sections: clean, factIds: ["f-score"], quoteIds: ["q-1", "q-404"], facts, quotes });
    expect(r.quoteIdsUsed).toEqual(["q-1"]);
    expect(r.checks.droppedQuoteIds).toEqual(["q-404"]);
    expect(kinds(r.warnings)).toContain("unknown_quote");
  });

  it("produces no warnings for a fully grounded script", () => {
    const r = groundScript({ sections: clean, factIds: ["f-score"], quoteIds: ["q-1"], facts, quotes });
    expect(r.warnings).toEqual([]);
  });
});

describe("groundScript — numbers", () => {
  it("flags numbers that appear in no provided fact claim", () => {
    const r = groundScript({
      sections: { ...clean, escalation: "60,000 fans fell silent as Inter kept 72% of the ball." },
      factIds: ["f-score"],
      facts,
      quotes,
    });
    expect(r.checks.ungroundedNumbers).toEqual(["60000", "72"]);
    const w = r.warnings.map(parseWarning).find((x) => x.kind === "ungrounded_number")!;
    expect(w.message).toMatch(/“60000”, “72” are not in any provided fact/);
  });

  it("accepts numbers from any provided fact, written differently", () => {
    const r = groundScript({
      sections: { ...clean, hook: "Bologna won 3–0 at San Siro", context: "It happened on 04 October, 2026." },
      factIds: ["f-score"],
      facts,
      quotes,
    });
    expect(r.checks.ungroundedNumbers).toEqual([]);
  });

  it("flags every number when no research exists", () => {
    const r = groundScript({ sections: clean, factIds: [], facts: [], quotes: [] });
    expect(r.checks.ungroundedNumbers.length).toBeGreaterThan(0);
    expect(kinds(r.warnings)).toEqual(expect.arrayContaining(["ungrounded_number", "no_facts"]));
  });
});

describe("groundScript — status and quotes", () => {
  it("lists used facts that are not confirmed", () => {
    const r = groundScript({ sections: clean, factIds: ["f-score", "f-brace", "f-coach"], facts, quotes });
    expect(r.checks.unconfirmedFactIds).toEqual(["f-brace", "f-coach"]);
    const w = r.warnings.map(parseWarning).find((x) => x.kind === "unconfirmed_fact")!;
    expect(w.message).toMatch(/probable/);
    expect(w.message).toMatch(/uncertain/);
  });

  it("flags quotations that are not saved research quotes", () => {
    const r = groundScript({
      sections: { ...clean, payoff: "Fans said Inter “lost the plot completely” at home." },
      factIds: ["f-score"],
      facts,
      quotes,
    });
    expect(r.checks.unbackedQuotes).toEqual(["lost the plot completely"]);
    expect(kinds(r.warnings)).toContain("unbacked_quote");
  });

  it("accepts an exact excerpt of a saved quote (any quote marks, accents and case ignored)", () => {
    const r = groundScript({
      sections: { ...clean, reveal: 'Italiano: "we pressed them like never before"' },
      factIds: ["f-score"],
      facts,
      quotes,
    });
    expect(r.checks.unbackedQuotes).toEqual([]);
  });

  it("keeps what the model says is missing as to-dos and says when no fact is cited", () => {
    const r = groundScript({ sections: clean, factIds: [], missing: ["Attendance figure", "  ", "Coach reaction"], facts, quotes });
    const parsed = r.warnings.map(parseWarning);
    expect(parsed.filter((w) => w.kind === "missing_info").map((w) => w.message)).toEqual(["Attendance figure", "Coach reaction"]);
    expect(parsed.find((w) => w.kind === "no_facts")?.message).toMatch(/does not cite any provided fact/);
  });

  it("caps the number of stored warnings", () => {
    const r = groundScript({ sections: clean, factIds: ["x"], missing: Array.from({ length: 30 }, (_, i) => `gap ${i}`), facts, quotes });
    expect(r.warnings.length).toBeLessThanOrEqual(MAX_WARNINGS);
  });
});

describe("warning storage format", () => {
  it("round-trips kind and message through the text[] column", () => {
    expect(parseWarning(formatWarning({ kind: "ungrounded_number", message: "“5” is not in any provided fact." }))).toEqual({
      kind: "ungrounded_number",
      message: "“5” is not in any provided fact.",
    });
    expect(parseWarning(formatWarning({ kind: "note", message: "Checked by hand" }))).toEqual({ kind: "note", message: "Checked by hand" });
    expect(parseWarning("free text without a kind")).toEqual({ kind: "note", message: "free text without a kind" });
  });
});

describe("text helpers", () => {
  it("canonicalises numbers", () => {
    expect(canonicalNumber("1,000")).toBe("1000");
    expect(canonicalNumber("1.000")).toBe("1000");
    expect(canonicalNumber("2,5")).toBe("2.5");
    expect(canonicalNumber("07")).toBe("7");
    expect(extractNumbers("3-0 after 90 minutes, 3 points")).toEqual(["3", "0", "90"]);
  });

  it("extracts quotations of at least three words", () => {
    expect(extractQuotations("He said “we were brave tonight” and «non abbiamo paura oggi» but \"no\"")).toEqual([
      "we were brave tonight",
      "non abbiamo paura oggi",
    ]);
  });

  it("composes the full text in section order and estimates voiceover length", () => {
    expect(composeFullText({ ...clean, escalation: "  " }).split("\n\n")).toHaveLength(5);
    expect(estimateDurationSec(0)).toBeNull();
    expect(estimateDurationSec(150)).toBe(60);
    expect(estimateDurationSec(3)).toBe(5);
  });
});
