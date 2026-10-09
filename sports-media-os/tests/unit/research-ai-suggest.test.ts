import { describe, expect, it, vi } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AIProvider, TaskModelConfig, UsageEvent } from "@/lib/ai/types";
import { readSuggestRunSummary, requestResearchSuggestions, sanitiseResearchSuggestions, SUGGESTION_LIMITS } from "@/lib/research/ai-suggest";
import { buildResearchSuggestMessages, MAX_SOURCES_IN_RESEARCH_PROMPT, type ResearchSuggestOutput } from "@/prompts/research/suggest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

const usage = { inputTokens: 2000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 };
const noneExisting = { claims: [], questions: [], timeline: [], context: [] };

function output(over: Partial<ResearchSuggestOutput> = {}): ResearchSuggestOutput {
  return { questions: [], claims: [], timeline: [], context: [], ...over };
}

function fakeRouter(payload: unknown, events: UsageEvent[] = []) {
  const complete = vi.fn<AIProvider["complete"]>(async () => ({
    text: JSON.stringify(payload),
    usage,
    servedModel: "claude-sonnet-5-5",
    latencyMs: 20,
    stopReason: "end_turn",
  }));
  const provider: AIProvider = { id: "anthropic", isConfigured: () => true, complete };
  const config: TaskModelConfig = {
    task: "research",
    primary: { provider: "anthropic", model: "claude-sonnet-5-5" },
    fallbacks: [],
    effort: "medium",
    maxOutputTokens: 8000,
    source: "default",
  };
  const router = createAIRouter({ providers: { anthropic: provider }, resolveConfig: () => config, onUsage: (e) => void events.push(e) });
  return { router, complete };
}

const input = {
  opportunity: {
    title: "Bologna stun Inter 3-0 at San Siro",
    description: null,
    why_now: "Finished 2h ago",
    angle: "The pressing trap",
    hook: null,
    competition: "Serie A",
    sport: "Football",
  },
  sources: [
    { id: A, title: "Bologna win 3-0 at San Siro", summary: "Orsolini scored twice.", url: "https://agency.test/a", publisher: "Agency" },
    { id: B, title: "Inter's first home defeat", summary: null, url: "https://daily.test/b", publisher: "Daily" },
  ],
};

describe("research suggestions — sanitising", () => {
  it("drops source ids that were not provided and claims left without a source", () => {
    const s = sanitiseResearchSuggestions(
      output({
        claims: [
          { claim: "Bologna won 3-0 at San Siro", sourceIds: [A, FOREIGN], isCritical: true },
          { claim: "Orsolini has scored in five straight games", sourceIds: [FOREIGN], isCritical: true },
          { claim: "Inter have lost 4 of their last 5", sourceIds: [], isCritical: true },
        ],
      }),
      [A, B],
      noneExisting,
    );
    expect(s.claims).toEqual([{ claim: "Bologna won 3-0 at San Siro", sourceIds: [A], isCritical: true }]);
    expect(s.dropped.foreignSourceIds).toBe(2);
    expect(s.dropped.unsourcedClaims).toBe(2);
  });

  it("keeps an unsourced claim only when it is phrased as a question (it becomes a question)", () => {
    const s = sanitiseResearchSuggestions(
      output({ claims: [{ claim: "Was this Inter's first home defeat of the season?", sourceIds: [], isCritical: true }] }),
      [A],
      noneExisting,
    );
    expect(s.claims).toHaveLength(0);
    expect(s.questions).toEqual(["Was this Inter's first home defeat of the season?"]);
    expect(s.dropped.claimsAsQuestions).toBe(1);
  });

  it("never repeats what the workspace already holds (case, accents and punctuation ignored)", () => {
    const s = sanitiseResearchSuggestions(
      output({
        claims: [
          { claim: "Bologna won 3–0 at San Siro.", sourceIds: [A], isCritical: true },
          { claim: "Orsolini scored twice", sourceIds: [A], isCritical: true },
          { claim: "orsolini SCORED twice!", sourceIds: [A], isCritical: true },
        ],
        questions: ["Who was the referee?", "who was the referee"],
        context: [{ title: null, note: "Bologna press high", sourceIds: [A] }],
      }),
      [A],
      { claims: ["Bologna won 3 0 at San Siro"], questions: [], timeline: [], context: ["Bologna press high."] },
    );
    expect(s.claims.map((c) => c.claim)).toEqual(["Orsolini scored twice"]);
    expect(s.questions).toEqual(["Who was the referee?"]);
    expect(s.context).toHaveLength(0);
    expect(s.dropped.duplicates).toBe(4);
  });

  it("requires sources for timeline and context, validates dates and sorts the timeline", () => {
    const s = sanitiseResearchSuggestions(
      output({
        timeline: [
          { date: "2026-10-04", event: "Bologna win 3-0", sourceIds: [A] },
          { date: "2026-09-28", event: "Inter beat Roma", sourceIds: [B] },
          { date: "last Sunday", event: "Training camp", sourceIds: [A] },
          { date: null, event: "Coach sacked", sourceIds: [FOREIGN] },
        ],
        context: [
          { title: "Form", note: "Bologna unbeaten in 6", sourceIds: [] },
          { title: "  ", note: "Inter top of the table before kick-off", sourceIds: [B, B] },
        ],
      }),
      [A, B],
      noneExisting,
    );
    expect(s.timeline).toEqual([
      { occurredAt: "2026-09-28T00:00:00.000Z", event: "Inter beat Roma", sourceIds: [B] },
      { occurredAt: "2026-10-04T00:00:00.000Z", event: "Bologna win 3-0", sourceIds: [A] },
      { occurredAt: null, event: "Training camp", sourceIds: [A] },
    ]);
    expect(s.dropped.invalidDates).toBe(1);
    expect(s.dropped.unsourcedTimeline).toBe(1);
    expect(s.context).toEqual([{ title: null, note: "Inter top of the table before kick-off", sourceIds: [B] }]);
    expect(s.dropped.unsourcedContext).toBe(1);
  });

  it("caps every list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ claim: `Claim number ${i}`, sourceIds: [A], isCritical: i % 2 === 0 }));
    const s = sanitiseResearchSuggestions(output({ claims: many, questions: many.map((c) => `${c.claim}?`) }), [A], noneExisting);
    expect(s.claims).toHaveLength(SUGGESTION_LIMITS.claims);
    expect(s.questions).toHaveLength(SUGGESTION_LIMITS.questions);
    expect(s.claims[1].isCritical).toBe(false);
  });
});

describe("research suggestions — through the AI router (fake provider)", () => {
  it("uses the research task, sends only the opportunity fields and provided sources, and sanitises the answer", async () => {
    const events: UsageEvent[] = [];
    const { router, complete } = fakeRouter(
      {
        questions: ["What did the coach say after the match?"],
        claims: [
          { claim: "Orsolini scored twice", sourceIds: [A], isCritical: true },
          { claim: "Inter's coach has been sacked", sourceIds: [FOREIGN], isCritical: true },
        ],
        timeline: [{ date: "2026-10-04", event: "Bologna win at San Siro", sourceIds: [A, B] }],
        context: [],
      },
      events,
    );

    const res = await requestResearchSuggestions(router, input, noneExisting);
    expect(res.suggestions.claims).toEqual([{ claim: "Orsolini scored twice", sourceIds: [A], isCritical: true }]);
    expect(res.suggestions.dropped.foreignSourceIds).toBe(1);
    expect(res.suggestions.timeline[0].sourceIds).toEqual([A, B]);
    expect(res.providedSourceIds).toEqual([A, B]);
    expect(res.model).toBe("claude-sonnet-5-5");

    // every call is logged with its task
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ task: "research", status: "success" });

    // the prompt holds the opportunity + sources and nothing else
    const request = complete.mock.calls[0][1] as { system: string; messages: { content: string }[]; cacheSystemPrompt: boolean };
    expect(request.cacheSystemPrompt).toBe(true);
    const data = JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(request.messages[0].content)![1]);
    expect(Object.keys(data)).toEqual(["opportunity", "sources"]);
    expect(data.sources.map((s: { id: string }) => s.id)).toEqual([A, B]);
    expect(Object.keys(data.sources[0]).sort()).toEqual(["id", "publisher", "summary", "title", "url"]);
  });

  it("output has no status field: nothing the model returns can confirm a claim", async () => {
    const { router } = fakeRouter({
      questions: [],
      claims: [{ claim: "Bologna won", sourceIds: [A], isCritical: true, status: "confirmed", relation: "supports" }],
      timeline: [],
      context: [],
    });
    const res = await requestResearchSuggestions(router, input, noneExisting);
    expect(res.suggestions.claims[0]).toEqual({ claim: "Bologna won", sourceIds: [A], isCritical: true });
    expect(Object.keys(res.suggestions.claims[0])).not.toContain("status");
  });

  it("limits the sources in the prompt (cost control)", () => {
    const sources = Array.from({ length: MAX_SOURCES_IN_RESEARCH_PROMPT + 5 }, (_, i) => ({
      id: `id-${i}`,
      title: `t${i}`,
      summary: "x".repeat(2000),
      url: `https://s.test/${i}`,
      publisher: null,
    }));
    const msg = buildResearchSuggestMessages({ ...input, sources })[0].content;
    const data = JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(msg)![1]);
    expect(data.sources).toHaveLength(MAX_SOURCES_IN_RESEARCH_PROMPT);
    expect(data.sources[0].summary.length).toBeLessThanOrEqual(600);
  });

  it("an invalid model answer fails the call (the job retries) instead of storing garbage", async () => {
    const { router } = fakeRouter({ claims: "Bologna won" });
    await expect(requestResearchSuggestions(router, input, noneExisting)).rejects.toMatchObject({ kind: "all_failed" });
  });
});

describe("research suggestions — last run summary (job result)", () => {
  it("reads the worker's result and never trusts it blindly", () => {
    expect(
      readSuggestRunSummary({
        model: "claude-sonnet-5-5",
        costUsd: 0.0123,
        sourcesProvided: 3,
        inserted: { claims: 2, questions: 3, timeline: 1, context: 0 },
        dropped: { foreignSourceIds: 4, unsourcedClaims: 2, unsourcedTimeline: 1, unsourcedContext: 0, duplicates: 5, claimsAsQuestions: 1 },
        droppedTotal: 12,
      }),
    ).toEqual({
      model: "claude-sonnet-5-5",
      costUsd: 0.0123,
      sourcesProvided: 3,
      inserted: { claims: 2, questions: 3, timeline: 1, context: 0 },
      droppedUnsourced: 3,
      duplicates: 5,
    });
    expect(readSuggestRunSummary(null)).toBeNull();
    expect(readSuggestRunSummary({ inserted: "lots" })).toBeNull();
    expect(readSuggestRunSummary({ inserted: { claims: -1, questions: 1.5, timeline: 0, context: 0 }, costUsd: -3 })).toMatchObject({
      inserted: { claims: 0, questions: 0, timeline: 0, context: 0 },
      costUsd: null,
      droppedUnsourced: 0,
    });
  });
});
