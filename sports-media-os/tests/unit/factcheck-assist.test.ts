import { describe, expect, it, vi } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import type { AIProvider, TaskModelConfig, UsageEvent } from "@/lib/ai/types";
import { requestFactCheck } from "@/lib/factcheck/assess";
import { summariseEvidence } from "@/lib/factcheck/evidence";
import { confidenceBand, describeChecker, FACT_STATUS_VIEW, formatConfidence } from "@/lib/factcheck/presentation";
import {
  buildStoredSuggestion,
  filterKnownIds,
  normaliseForCompare,
  readStoredSuggestion,
  sanitiseFactCheck,
  suggestionStaleReason,
} from "@/lib/factcheck/sanitize";
import type { FactCheckAssessInput, FactCheckOutput } from "@/prompts/factcheck/assess";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "99999999-9999-4999-8999-999999999999";

const out = (over: Partial<FactCheckOutput> = {}): FactCheckOutput => ({
  suggestedStatus: "probable",
  confidence: 0.7,
  reasoning: "The agency report says so.",
  sources: [],
  ...over,
});

describe("evidence summary", () => {
  it("counts supports vs contradicts and mirrors the DB confirm rule", () => {
    expect(summariseEvidence([], true)).toMatchObject({ verdict: "unsourced", canConfirm: false, total: 0 });
    expect(summariseEvidence([], false)).toMatchObject({ verdict: "unsourced", canConfirm: true });
    expect(summariseEvidence([{ relation: "mentions" }], true)).toMatchObject({ verdict: "mentioned_only", canConfirm: false });
    expect(summariseEvidence([{ relation: "supports" }, { relation: "mentions" }], true)).toMatchObject({
      verdict: "supported",
      supports: 1,
      mentions: 1,
      canConfirm: true,
    });
    const contested = summariseEvidence([{ relation: "supports" }, { relation: "contradicts" }, { relation: "contradicts" }], true);
    expect(contested).toMatchObject({ verdict: "contested", supports: 1, contradicts: 2, total: 3, canConfirm: true });
    expect(contested.hint).toMatch(/disagree/);
    expect(summariseEvidence([{ relation: "contradicts" }], true)).toMatchObject({ verdict: "contradicted", canConfirm: false });
  });
});

describe("presentation", () => {
  it("formats confidence without inventing a value", () => {
    expect(formatConfidence(0.856)).toBe("86%");
    expect(formatConfidence(null)).toBe("—");
    expect(formatConfidence(1.4)).toBe("100%");
    expect(confidenceBand(0.85)).toBe("high");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.2)).toBe("low");
    expect(confidenceBand(undefined)).toBe("none");
  });

  it("labels every status and says who checked", () => {
    expect(Object.keys(FACT_STATUS_VIEW).sort()).toEqual(["confirmed", "false", "probable", "uncertain"]);
    expect(describeChecker({ checkedByName: null, checkedBy: null, checkedByAgent: "researcher" })).toMatch(/Researcher agent/);
    expect(describeChecker({ checkedByName: "Ada", checkedBy: "u1", checkedByAgent: null })).toBe("Ada");
    expect(describeChecker({ checkedByName: null, checkedBy: "u1", checkedByAgent: null })).toBe("a team member");
  });
});

describe("fact-check sanitising", () => {
  it("drops foreign and duplicate source ids", () => {
    const s = sanitiseFactCheck(
      out({
        sources: [
          { sourceId: A, relation: "supports", note: "states 3-0" },
          { sourceId: FOREIGN, relation: "supports", note: null },
          { sourceId: A, relation: "contradicts", note: null },
        ],
      }),
      [A, B],
    );
    expect(s.sources).toEqual([{ sourceId: A, relation: "supports", note: "states 3-0" }]);
    expect(s.droppedSourceIds).toBe(1);
    expect(s.suggestedStatus).toBe("probable");
  });

  it("lowers 'confirmed' to uncertain unless a provided source supports it (and none contradicts)", () => {
    const viaForeign = sanitiseFactCheck(out({ suggestedStatus: "confirmed", confidence: 0.95, sources: [{ sourceId: FOREIGN, relation: "supports", note: null }] }), [A]);
    expect(viaForeign).toMatchObject({ suggestedStatus: "uncertain", confidence: 0.5 });
    expect(viaForeign.adjustment).toMatch(/without citing/);

    const onlyMentions = sanitiseFactCheck(out({ suggestedStatus: "confirmed", confidence: 0.9, sources: [{ sourceId: A, relation: "mentions", note: null }] }), [A]);
    expect(onlyMentions.suggestedStatus).toBe("uncertain");

    const conflicting = sanitiseFactCheck(
      out({
        suggestedStatus: "confirmed",
        confidence: 0.9,
        sources: [
          { sourceId: A, relation: "supports", note: null },
          { sourceId: B, relation: "contradicts", note: null },
        ],
      }),
      [A, B],
    );
    expect(conflicting.suggestedStatus).toBe("uncertain");

    const fine = sanitiseFactCheck(out({ suggestedStatus: "confirmed", confidence: 0.9, sources: [{ sourceId: A, relation: "supports", note: null }] }), [A]);
    expect(fine).toMatchObject({ suggestedStatus: "confirmed", confidence: 0.9, adjustment: null });
  });

  it("lowers 'false' without a contradicting source", () => {
    const s = sanitiseFactCheck(out({ suggestedStatus: "false", confidence: 0.8, sources: [{ sourceId: A, relation: "mentions", note: null }] }), [A]);
    expect(s).toMatchObject({ suggestedStatus: "uncertain", confidence: 0.5 });
  });

  it("filterKnownIds keeps order and removes duplicates", () => {
    expect(filterKnownIds([B, A, FOREIGN, B], new Set([A, B]))).toEqual({ ids: [B, A], dropped: 1 });
  });

  it("normalises text for comparisons", () => {
    expect(normaliseForCompare("  Bologna  won 3–0, at SAN SIRO! ")).toBe(normaliseForCompare("bologna won 3 0 at san siro"));
    expect(normaliseForCompare("Città")).toBe("citta");
  });
});

describe("stored suggestion", () => {
  const meta = {
    claim: "Bologna won 3-0",
    assessedSourceIds: [A, B],
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    promptVersion: "factcheck-assess-v1",
    at: new Date("2026-10-08T10:00:00Z"),
    jobId: null,
    costUsd: 0.004,
  };

  it("round-trips through JSON and rejects malformed values", () => {
    const stored = buildStoredSuggestion(sanitiseFactCheck(out({ sources: [{ sourceId: A, relation: "supports", note: null }] }), [A, B]), meta);
    expect(readStoredSuggestion(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(readStoredSuggestion({ ...stored, suggestedStatus: "verified" })).toBeNull();
    expect(readStoredSuggestion(null)).toBeNull();
    expect(readStoredSuggestion("confirmed")).toBeNull();
  });

  it("is stale when the claim text or the set of linked sources changed (not when relations change)", () => {
    const s = { claim: "Bologna won 3-0", assessedSourceIds: [A, B] };
    expect(suggestionStaleReason(s, { claim: "Bologna won 3-0.", sourceIds: [B, A] })).toBeNull();
    expect(suggestionStaleReason(s, { claim: "Bologna won 4-0", sourceIds: [A, B] })).toMatch(/edited/);
    expect(suggestionStaleReason(s, { claim: "Bologna won 3-0", sourceIds: [A] })).toMatch(/sources changed/);
    expect(suggestionStaleReason(s, { claim: "Bologna won 3-0", sourceIds: [A, B, FOREIGN] })).toMatch(/sources changed/);
  });
});

describe("fact-check assist — through the AI router (fake provider)", () => {
  const input: FactCheckAssessInput = {
    claim: { text: "Bologna won 3-0 at San Siro", isCritical: true },
    sources: [
      { id: A, title: "Bologna win 3-0", publisher: "Agency", url: "https://a.test", summary: null, relation: "mentions", excerpt: "Bologna won 3-0", locator: "para 1" },
      { id: B, title: "Inter beaten", publisher: "Daily", url: "https://b.test", summary: "Inter lost at home.", relation: "mentions", excerpt: null, locator: null },
    ],
  };

  function router(payload: unknown, events: UsageEvent[] = []) {
    const complete = vi.fn<AIProvider["complete"]>(async () => ({
      text: JSON.stringify(payload),
      usage: { inputTokens: 900, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: "claude-sonnet-5-5",
      latencyMs: 10,
      stopReason: "end_turn",
    }));
    const provider: AIProvider = { id: "anthropic", isConfigured: () => true, complete };
    const cfg: TaskModelConfig = {
      task: "fact_check",
      primary: { provider: "anthropic", model: "claude-sonnet-5-5" },
      fallbacks: [],
      effort: "high",
      maxOutputTokens: 6000,
      source: "default",
    };
    return { ai: createAIRouter({ providers: { anthropic: provider }, resolveConfig: () => cfg, onUsage: (e) => void events.push(e) }), complete };
  }

  it("uses the fact_check task, sees only the claim and its linked sources, returns a sanitised suggestion", async () => {
    const events: UsageEvent[] = [];
    const { ai, complete } = router(
      {
        suggestedStatus: "confirmed",
        confidence: 0.92,
        reasoning: 'The agency excerpt reads "Bologna won 3-0".',
        sources: [
          { sourceId: A, relation: "supports", note: "exact score" },
          { sourceId: FOREIGN, relation: "supports", note: "invented" },
          { sourceId: B, relation: "mentions", note: null },
        ],
      },
      events,
    );
    const res = await requestFactCheck(ai, input);
    expect(res.suggestion).toMatchObject({ suggestedStatus: "confirmed", confidence: 0.92, droppedSourceIds: 1 });
    expect(res.suggestion.sources.map((s) => s.sourceId)).toEqual([A, B]);
    expect(res.assessedSourceIds).toEqual([A, B]);
    expect(events[0]).toMatchObject({ task: "fact_check", status: "success" });

    const request = complete.mock.calls[0][1] as { messages: { content: string }[] };
    const data = JSON.parse(/<data>\n([\s\S]*)\n<\/data>/.exec(request.messages[0].content)![1]);
    expect(Object.keys(data)).toEqual(["claim", "critical", "sources"]);
    expect(data.sources[0]).toMatchObject({ id: A, excerpt: "Bologna won 3-0", current_relation: "mentions" });
  });

  it("a 'confirmed' answer backed only by an invented source becomes 'uncertain'", async () => {
    const { ai } = router({
      suggestedStatus: "confirmed",
      confidence: 0.99,
      reasoning: "Everyone knows it.",
      sources: [{ sourceId: FOREIGN, relation: "supports", note: null }],
    });
    const res = await requestFactCheck(ai, input);
    expect(res.suggestion).toMatchObject({ suggestedStatus: "uncertain", confidence: 0.5, droppedSourceIds: 1 });
  });
});
