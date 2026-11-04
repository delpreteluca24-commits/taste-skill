import { describe, expect, it } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider, AIRequest } from "@/lib/ai/types";
import { blendHookScore, scoreHook } from "@/lib/scoring/hook";
import { cleanHookText, generateHookSet, hookScoringContext, readHookExplanation, sanitiseHooks, scoreManualHook } from "@/lib/scripts/hooks";
import { HOOKS_SYSTEM, type HooksOutput } from "@/prompts/hooks/generate";
import type { StoryPromptContext } from "@/prompts/script/context";

/**
 * Hook Studio: the Hook agent's hooks are cleaned, deduplicated, their fact ids
 * validated, and scored as 0.6 × transparent heuristic + 0.4 × the model's
 * score — so the model can't talk a clickbait hook back up.
 */

const ctx: StoryPromptContext = {
  story: { title: "Bologna stun Inter at San Siro", logline: null, angle: null },
  opportunity: { title: "Bologna stun Inter 3-0", description: null, whyNow: null, angle: null, hook: null, competition: "Serie A" },
  facts: [
    { id: "f-score", claim: "Bologna beat Inter 3-0 at San Siro", status: "confirmed", isCritical: true, sourceIds: [] },
    { id: "f-brace", claim: "Orsolini scored twice in the second half", status: "probable", isCritical: false, sourceIds: [] },
  ],
  sources: [{ id: "s-1", title: "Agency report", publisher: "Agency" }],
  quotes: [],
  productionFormats: [],
  language: "en",
};

const hook = (over: Partial<HooksOutput["hooks"][number]>): HooksOutput["hooks"][number] => ({
  hook_type: "curiosity",
  text: "Why Bologna's 3-0 at San Siro started with one pressing trap",
  angle: "analysis",
  facts_used: ["f-score"],
  score: 80,
  rationale: "Specific and honest.",
  ...over,
});

describe("sanitiseHooks", () => {
  it("prefers one hook per type, then fills up to the requested count", () => {
    const out: HooksOutput = {
      hooks: [
        hook({ hook_type: "curiosity", text: "Why Bologna's 3-0 started with a trap" }),
        hook({ hook_type: "curiosity", text: "How Bologna silenced San Siro in the second half" }),
        hook({ hook_type: "statistical", text: "3-0 at San Siro: Inter's night in one number" }),
        hook({ hook_type: "story", text: "Orsolini scored twice in the second half, and San Siro went quiet" }),
        hook({ hook_type: "mystery", text: "One change at half-time decided Bologna's night at San Siro" }),
        hook({ hook_type: "shock", text: "Bologna beat Inter 3-0 at San Siro" }),
        hook({ hook_type: "curiosity", text: "What Bologna saw in Inter that nobody else did" }),
      ],
      missing: ["Coach quotes"],
    };
    const r = sanitiseHooks(out, ctx, { count: 5, existing: [], model: "claude-sonnet-5-5" });
    expect(r.hooks.map((h) => h.hookType)).toEqual(["curiosity", "statistical", "story", "mystery", "shock"]);
    expect(r.distinctTypes).toBe(5);
    expect(r.dropped.overLimit).toBe(2);
    expect(r.missing).toEqual(["Coach quotes"]);
  });

  it("drops empty, over-long and duplicate hooks (also against the story's existing hooks)", () => {
    const out: HooksOutput = {
      hooks: [
        hook({ text: "   " }),
        hook({ text: "x".repeat(301) }),
        hook({ hook_type: "shock", text: "Bologna beat Inter 3-0 at San Siro." }),
        hook({ hook_type: "story", text: "“Orsolini scored twice in the second half”" }),
        hook({ hook_type: "mystery", text: "orsolini SCORED twice in the second half" }),
      ],
      missing: [],
    };
    const r = sanitiseHooks(out, ctx, { count: 5, existing: ["Bologna beat Inter 3-0 at San Siro"], model: null });
    expect(r.hooks.map((h) => h.text)).toEqual(["Orsolini scored twice in the second half"]);
    expect(r.dropped).toMatchObject({ discarded: 2, duplicates: 2 });
  });

  it("keeps only provided fact ids and counts the foreign ones", () => {
    const r = sanitiseHooks({ hooks: [hook({ facts_used: ["f-score", "invented", "f-score"] })], missing: [] }, ctx, {
      count: 5,
      existing: [],
      model: "m",
    });
    expect(r.hooks[0].explanation.factsUsed).toEqual(["f-score"]);
    expect(r.hooks[0].explanation.droppedFactIds).toBe(1);
    expect(r.dropped.foreignFactIds).toBe(1);
  });

  it("scores = blend of the transparent heuristic and the model's score, both explained", () => {
    const text = "You won't believe what happened at San Siro!!!";
    const r = sanitiseHooks({ hooks: [hook({ hook_type: "shock", text, score: 100 })], missing: [] }, ctx, { count: 5, existing: [], model: "m" });
    const h = r.hooks[0];
    const heuristic = scoreHook(text, hookScoringContext(ctx)).score;
    expect(h.score).toBe(blendHookScore(heuristic, 100));
    expect(h.score).toBeLessThan(70); // the model's 100 can't make clickbait strong
    expect(h.explanation).toMatchObject({
      method: "blend",
      heuristic: { score: heuristic },
      ai: { score: 100, rationale: "Specific and honest.", model: "m" },
      blend: { heuristic: 0.6, ai: 0.4 },
    });
    expect(h.explanation.heuristic.factors.map((f) => f.name)).toEqual(expect.arrayContaining(["clickbait", "punctuation"]));
  });

  it("flags numbers in a hook that are not in the facts", () => {
    const r = sanitiseHooks({ hooks: [hook({ hook_type: "statistical", text: "Bologna scored 5 at San Siro" })], missing: [] }, ctx, {
      count: 5,
      existing: [],
      model: "m",
    });
    expect(r.hooks[0].explanation.heuristic.unsupportedNumbers).toEqual(["5"]);
  });
});

describe("generateHookSet (fake router)", () => {
  it("sends the hooks prompt on the SCRIPT task and returns scored hooks", async () => {
    const requests: AIRequest[] = [];
    const provider: AIProvider = {
      id: "anthropic",
      isConfigured: () => true,
      complete: async (_m, request): Promise<AICallResult> => {
        requests.push(request);
        return {
          text: JSON.stringify({ hooks: [hook({}), hook({ hook_type: "story", text: "Orsolini scored twice in the second half" })], missing: [] }),
          usage: { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
          servedModel: "claude-sonnet-5-5",
          latencyMs: 2,
          stopReason: "end_turn",
        };
      },
    };
    const router = createAIRouter({
      providers: { anthropic: provider },
      resolveConfig: (task) => ({ task, primary: { provider: "anthropic", model: "claude-sonnet-5-5" }, fallbacks: [], effort: "medium", maxOutputTokens: 4000, source: "default" }),
    });
    const { result, meta } = await generateHookSet(router, ctx, { count: 5, existing: [] });
    expect(requests[0]).toMatchObject({ system: HOOKS_SYSTEM, cacheSystemPrompt: true });
    expect(result.hooks).toHaveLength(2);
    expect(result.hooks.every((h) => h.explanation.ai?.model === "claude-sonnet-5-5")).toBe(true);
    expect(meta).toMatchObject({ model: "claude-sonnet-5-5", promptVersion: "hooks-generate-v1" });
  });
});

describe("manual hooks and stored explanations", () => {
  it("scores a manual hook with the heuristic only", () => {
    const r = scoreManualHook("Why Bologna's 3-0 at San Siro started with one trap", ctx);
    expect(r.explanation).toMatchObject({ method: "heuristic", ai: null, blend: null });
    expect(r.score).toBe(r.explanation.heuristic.score);
  });

  it("reads stored explanations defensively", () => {
    const stored = scoreManualHook("Bologna beat Inter 3-0 at San Siro", ctx).explanation;
    expect(readHookExplanation(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(readHookExplanation(null)).toBeNull();
    expect(readHookExplanation({ nonsense: true })).toBeNull();
    const tampered = readHookExplanation({ ...stored, heuristic: { ...stored.heuristic, factors: [{ name: "evil", delta: 1, reason: "x" }] } });
    expect(tampered?.heuristic.factors).toEqual([]);
  });

  it("cleans hook text (one line, no wrapping quotes)", () => {
    expect(cleanHookText('  "Bologna won   at\nSan Siro"  ')).toBe("Bologna won at San Siro");
    expect(cleanHookText("“He said “no” twice”")).toBe("“He said “no” twice”");
  });
});
