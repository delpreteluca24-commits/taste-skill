import { describe, expect, it } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AICallResult, AIProvider, AIRequest, AITask, UsageEvent } from "@/lib/ai/types";
import { buildDraft, generateAngleDraft, SECTION_LIMITS, summariseUsage, transformDraft } from "@/lib/scripts/generate";
import { parseWarning } from "@/lib/scripts/grounding";
import { SCRIPT_SYSTEM } from "@/prompts/script/angles";
import type { StoryPromptContext } from "@/prompts/script/context";
import { SCRIPT_TRANSFORM_SYSTEM } from "@/prompts/script/transform";

/**
 * Script generation through the real router with a fake provider: the model's
 * output is grounded against the exact material it was shown before anything
 * could be stored. No real API calls.
 */

const ctx: StoryPromptContext = {
  story: { title: "Bologna stun Inter at San Siro", logline: null, angle: null },
  opportunity: null,
  facts: [
    { id: "f-score", claim: "Bologna beat Inter 3-0 at San Siro", status: "confirmed", isCritical: true, sourceIds: [] },
    { id: "f-brace", claim: "Orsolini scored twice", status: "probable", isCritical: false, sourceIds: [] },
  ],
  sources: [],
  quotes: [{ id: "q-coach", speaker: "Italiano", text: "We pressed them like never before.", sourceId: null }],
  productionFormats: [],
  language: "en",
};

function fakeRouter(outputs: unknown[]) {
  const requests: { task: AITask; request: AIRequest }[] = [];
  const events: UsageEvent[] = [];
  let i = 0;
  let task: AITask = "script";
  const provider: AIProvider = {
    id: "anthropic",
    isConfigured: () => true,
    complete: async (_model, request): Promise<AICallResult> => {
      requests.push({ task, request });
      const out = outputs[Math.min(i, outputs.length - 1)];
      i += 1;
      return {
        text: typeof out === "string" ? out : JSON.stringify(out),
        usage: { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 0 },
        servedModel: "claude-sonnet-5-5",
        latencyMs: 3,
        stopReason: "end_turn",
      };
    },
  };
  const router = createAIRouter({
    providers: { anthropic: provider },
    resolveConfig: (t) => {
      task = t;
      return { task: t, primary: { provider: "anthropic", model: "claude-sonnet-5-5" }, fallbacks: [], effort: "medium", maxOutputTokens: 4000, source: "default" };
    },
    onUsage: (e) => void events.push(e),
  });
  return { router, requests, events };
}

const output = (over: Record<string, unknown> = {}) => ({
  hook: "Bologna won 3-0 at San Siro.",
  context: "Inter lost at home.",
  escalation: "Orsolini scored twice, reports suggest.",
  reveal: "The press came from the wide players.",
  payoff: "A plan others will copy.",
  cta: "Follow for the breakdown.",
  facts_used: ["f-score", "f-brace"],
  quote_ids: [],
  missing: [],
  ...over,
});

describe("generateAngleDraft", () => {
  it("calls the SCRIPT task with the angle prompt and a cacheable system prompt", async () => {
    const ai = fakeRouter([output()]);
    const { draft, meta } = await generateAngleDraft(ai.router, ctx, "analysis");
    expect(ai.requests).toHaveLength(1);
    expect(ai.requests[0].task).toBe("script");
    expect(ai.requests[0].request).toMatchObject({ system: SCRIPT_SYSTEM, cacheSystemPrompt: true });
    expect(ai.requests[0].request.messages[0].content).toMatch(/"Analysis" angle/);
    expect(meta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", promptVersion: "script-angles-v1" });
    expect(meta.costUsd).toBeGreaterThan(0);
    expect(ai.events).toEqual([expect.objectContaining({ task: "script", status: "success" })]);

    expect(draft.angle).toBe("analysis");
    expect(draft.factsUsed).toEqual(["f-score", "f-brace"]);
    expect(draft.fullText.split("\n\n")).toHaveLength(6);
    expect(draft.wordCount).toBeGreaterThan(20);
    expect(draft.targetDurationSec).toBeGreaterThanOrEqual(5);
    // the probable fact is flagged, nothing else
    expect(draft.warnings.map((w) => parseWarning(w).kind)).toEqual(["unconfirmed_fact"]);
  });

  it("drops invented fact ids and flags invented numbers and quotes", async () => {
    const ai = fakeRouter([
      output({
        facts_used: ["f-score", "made-up-fact"],
        quote_ids: ["q-coach", "made-up-quote"],
        escalation: "60,000 fans watched Inter keep 72% of the ball.",
        payoff: "Italiano: “we were simply better than them”.",
        missing: ["Attendance figure"],
      }),
    ]);
    const { draft } = await generateAngleDraft(ai.router, ctx, "breaking_news");
    expect(draft.factsUsed).toEqual(["f-score"]);
    expect(draft.checks).toMatchObject({
      droppedFactIds: ["made-up-fact"],
      droppedQuoteIds: ["made-up-quote"],
      ungroundedNumbers: ["60000", "72"],
      unbackedQuotes: ["we were simply better than them"],
    });
    expect(draft.warnings.map((w) => parseWarning(w).kind)).toEqual([
      "unknown_fact",
      "unknown_quote",
      "ungrounded_number",
      "unbacked_quote",
      "missing_info",
    ]);
  });

  it("fails (no draft) when the model output is not a valid script", async () => {
    const ai = fakeRouter([{ hook: "only a hook" }]);
    await expect(generateAngleDraft(ai.router, ctx, "analysis")).rejects.toMatchObject({ kind: "all_failed" });
    expect(ai.events[0]).toMatchObject({ status: "error", errorCode: "invalid_output" });
  });
});

describe("transformDraft", () => {
  const parent = {
    angle: "storytelling" as const,
    sections: {
      hook: "Old hook.",
      context: "Original context stays.",
      escalation: "Original escalation stays.",
      reveal: "Original reveal stays.",
      payoff: "Original payoff stays.",
      cta: "Original CTA stays.",
    },
    tone: "neutral",
    factsUsed: ["f-score"],
  };

  it("rewrite_hook keeps the other five sections verbatim whatever the model returns", async () => {
    const ai = fakeRouter([output({ hook: "Nobody saw Bologna's 3-0 coming.", context: "The model rewrote this too.", facts_used: ["f-brace"] })]);
    const { draft, meta } = await transformDraft(ai.router, ctx, parent, "rewrite_hook");
    expect(ai.requests[0].request.system).toBe(SCRIPT_TRANSFORM_SYSTEM);
    expect(meta.promptVersion).toBe("script-transform-v1");
    expect(draft.sections).toEqual({ ...parent.sections, hook: "Nobody saw Bologna's 3-0 coming." });
    expect(draft.angle).toBe("storytelling");
    // the parent's cited facts carry over
    expect(draft.factsUsed).toEqual(["f-score", "f-brace"]);
  });

  it("other operations take the model's sections, grounded again", async () => {
    const ai = fakeRouter([output({ hook: "Bologna won 4-0.", facts_used: [] })]);
    const { draft } = await transformDraft(ai.router, ctx, parent, "shorten");
    expect(draft.sections.context).toBe("Inter lost at home.");
    expect(draft.checks.ungroundedNumbers).toEqual(["4"]);
    expect(draft.warnings.map((w) => parseWarning(w).kind)).toEqual(expect.arrayContaining(["ungrounded_number", "no_facts"]));
  });

  it("change_tone sends the requested tone as data", async () => {
    const ai = fakeRouter([output()]);
    await transformDraft(ai.router, ctx, parent, "change_tone", "calm and analytical");
    expect(ai.requests[0].request.messages[0].content).toContain('"requested_tone": "calm and analytical"');
  });
});

describe("buildDraft", () => {
  it("cleans whitespace, caps sections and warns about empty ones", () => {
    const draft = buildDraft(ctx, {
      angle: null,
      sections: {
        hook: "  Bologna   won at   San Siro  ",
        context: "x".repeat(SECTION_LIMITS.context + 50),
        escalation: "   ",
        reveal: "r",
        payoff: "p",
        cta: "",
      },
      factIds: ["f-score"],
    });
    expect(draft.sections.hook).toBe("Bologna won at San Siro");
    expect(draft.sections.context).toHaveLength(SECTION_LIMITS.context);
    expect(draft.sections.context.endsWith("…")).toBe(true);
    const empty = draft.warnings.map(parseWarning).find((w) => w.kind === "empty_section");
    expect(empty?.message).toMatch(/Escalation, CTA are empty/);
  });
});

describe("summariseUsage", () => {
  it("adds tokens over calls and sums only known costs", () => {
    const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 };
    const s = summariseUsage([
      { provider: "anthropic", model: "a", usage, costUsd: 0.001, promptVersion: "v" },
      { provider: "openai", model: "b", usage, costUsd: null, promptVersion: "v" },
    ]);
    expect(s).toEqual({ provider: "openai", model: "b", tokensIn: 230, tokensOut: 100, costUsd: 0.001 });
    expect(summariseUsage([]).costUsd).toBeNull();
  });
});
