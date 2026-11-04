import { describe, expect, it } from "vitest";

import { blendHookScore, HOOK_BASE_SCORE, HOOK_BLEND, scoreHook, type HookFactorName } from "@/lib/scoring/hook";

/**
 * Hook score: a transparent heuristic. Every point comes from a named factor
 * with a reason; clickbait and invented details are penalised.
 */

const facts = [
  "Bologna beat Inter 3-0 at San Siro on 4 October 2026",
  "Orsolini scored twice in the second half",
  "It was Inter's first home defeat of the season",
];
const reference = ["Bologna stun Inter at San Siro"];
const ctx = { facts, reference };

const factor = (text: string, name: HookFactorName, c = ctx) => scoreHook(text, c).factors.find((f) => f.name === name);

describe("hook score — transparency", () => {
  it("is the base plus the sum of its factors, each with a reason", () => {
    const r = scoreHook("Why Inter's first home defeat started with one pressing trap", ctx);
    expect(r.base).toBe(HOOK_BASE_SCORE);
    expect(r.score).toBe(Math.max(0, Math.min(100, r.base + r.factors.reduce((s, f) => s + f.delta, 0))));
    for (const f of r.factors) expect(f.reason.length).toBeGreaterThan(5);
  });

  it("stays within 0–100", () => {
    const worst = scoreHook("YOU WON'T BELIEVE THIS SHOCKING TRUTH!!! GONE WRONG?!", ctx);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    const best = scoreHook("Bologna won 3-0 at San Siro. Nobody saw the second half coming.", ctx);
    expect(best.score).toBeLessThanOrEqual(100);
  });
});

describe("hook score — factors", () => {
  it("rewards the Shorts length (6–14 words) and penalises long or tiny hooks", () => {
    expect(factor("Bologna won 3-0 at San Siro last night", "length")?.delta).toBeGreaterThan(0);
    expect(factor("Football", "length")?.delta).toBeLessThan(0);
    const long = "Orsolini scored twice in the second half and everyone in the stadium could not stop talking about it for hours after";
    expect(factor(long, "length")?.delta).toBeLessThan(0);
  });

  it("rewards specificity only from details in the facts", () => {
    const grounded = factor("Bologna won 3-0 at San Siro. Nobody saw it coming.", "specificity");
    expect(grounded?.delta).toBe(12);
    expect(grounded?.reason).toMatch(/3/);
    expect(factor("Something happened in a football match today", "specificity")?.delta).toBeLessThan(0);
  });

  it("rewards a curiosity gap (question or twist)", () => {
    expect(factor("Why Inter's first home defeat started with one pressing trap", "curiosity_gap")?.delta).toBeGreaterThan(0);
    expect(factor("Bologna beat Inter at San Siro in October", "curiosity_gap")?.delta).toBeLessThan(0);
  });

  it("rewards clarity and penalises clause-heavy hooks", () => {
    expect(factor("Bologna beat Inter at San Siro in October", "clarity")?.delta).toBeGreaterThan(0);
    expect(factor("Bologna, in October, at San Siro; against Inter: a win", "clarity")?.delta).toBeLessThan(0);
  });
});

describe("hook score — false-clickbait penalties", () => {
  it.each([
    ["You won't believe what happened at San Siro", -30],
    ["The shocking truth about Inter's defeat", -30],
    ["This Bologna result will shock you", -25],
    ["Inter's season gone wrong at San Siro", -20],
    ["A must-see night for Bologna at San Siro", -12],
  ])("%s", (text, delta) => {
    const f = factor(text, "clickbait");
    expect(f?.delta).toBe(delta);
    expect(f?.reason).toMatch(/False-promise phrasing/);
  });

  it("penalises ALL CAPS without counting shouted words as names", () => {
    const r = scoreHook("THIS RESULT IS INSANE", ctx);
    expect(r.factors.find((f) => f.name === "all_caps")?.delta).toBe(-15);
    expect(r.factors.find((f) => f.name === "specificity")?.delta).toBeLessThan(0);
    // an acronym in normal text is still a name
    expect(scoreHook("Bologna beat Inter while PSG watched", { facts: ["Bologna beat Inter; PSG scouts attended"] }).factors.find((f) => f.name === "all_caps")).toBeUndefined();
  });

  it("penalises excessive punctuation", () => {
    expect(factor("Bologna won 3-0 at San Siro!!!", "punctuation")?.delta).toBe(-8);
    expect(factor("Bologna won 3-0?! At San Siro!!", "punctuation")?.delta).toBe(-16);
    expect(factor("Bologna won 3-0 at San Siro.", "punctuation")).toBeUndefined();
  });

  it("puts a clickbait hook in the weak band even when it is short and specific", () => {
    expect(scoreHook("You won't believe what happened at San Siro!!!", ctx).score).toBeLessThan(50);
    expect(scoreHook("Bologna won 3-0 at San Siro. Nobody saw the second half coming.", ctx).score).toBeGreaterThanOrEqual(70);
  });
});

describe("hook score — facts check (when the facts are known)", () => {
  it("penalises numbers that are not in any fact", () => {
    const r = scoreHook("Bologna scored 5 goals at San Siro", ctx);
    expect(r.unsupportedNumbers).toEqual(["5"]);
    expect(r.factors.find((f) => f.name === "unsupported_number")).toMatchObject({ delta: -15 });
    expect(r.factors.find((f) => f.name === "grounded")).toBeUndefined();
  });

  it("matches numbers written differently (3-0, 1,000 vs 1000)", () => {
    expect(scoreHook("Bologna won 3-0 in front of 1000 fans", { facts: ["Bologna won 3-0; attendance 1,000"] }).unsupportedNumbers).toEqual([]);
  });

  it("penalises names that appear nowhere in the facts or story", () => {
    const f = factor("Why Mourinho was furious after Bologna's win", "unsupported_name");
    expect(f?.delta).toBe(-10);
    expect(f?.reason).toMatch(/Mourinho/);
  });

  it("rewards a hook whose every number and name is grounded", () => {
    expect(factor("Bologna won 3-0 at San Siro. Nobody saw it coming.", "grounded")?.delta).toBe(5);
  });

  it("checks against an empty fact list (nothing recorded yet) but not when facts are unknown", () => {
    expect(scoreHook("Bologna scored 5 goals", { facts: [] }).unsupportedNumbers).toEqual(["5"]);
    const unchecked = scoreHook("Bologna scored 5 goals", {});
    expect(unchecked.unsupportedNumbers).toEqual([]);
    expect(unchecked.factors.map((f) => f.name)).not.toContain("unsupported_number");
  });
});

describe("blendHookScore", () => {
  it("weights the heuristic 60% and the AI 40%", () => {
    expect(HOOK_BLEND).toEqual({ heuristic: 0.6, ai: 0.4 });
    expect(blendHookScore(40, 90)).toBe(60);
    expect(blendHookScore(80, 50)).toBe(68);
  });

  it("falls back to the heuristic without an AI score and clamps the AI score", () => {
    expect(blendHookScore(55, null)).toBe(55);
    expect(blendHookScore(55, undefined)).toBe(55);
    expect(blendHookScore(55, Number.NaN)).toBe(55);
    expect(blendHookScore(50, 400)).toBe(70);
  });

  it("can't lift a clickbait hook into the strong band", () => {
    const clickbait = scoreHook("You won't believe what happened at San Siro!!!", ctx).score;
    expect(blendHookScore(clickbait, 100)).toBeLessThan(70);
  });
});
