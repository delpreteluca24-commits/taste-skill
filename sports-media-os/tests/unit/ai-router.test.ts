import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAIRouter, extractJson } from "@/lib/ai/router";
import { AIError, type AICallResult, type AIProvider, type AIProviderId, type TaskModelConfig, type UsageEvent } from "@/lib/ai/types";

const usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };

function provider(id: AIProviderId, behaviour: (model: string) => Promise<AICallResult> | AICallResult, configured = true) {
  const complete = vi.fn(async (...args: [model: string, request?: unknown, schema?: unknown]) => behaviour(args[0]));
  const p: AIProvider = { id, isConfigured: () => configured, complete };
  return { p, complete };
}

const ok = (text: string, servedModel = "claude-haiku-5-5"): AICallResult => ({
  text,
  usage,
  servedModel,
  latencyMs: 12,
  stopReason: "end_turn",
});

function config(over: Partial<TaskModelConfig> = {}): TaskModelConfig {
  return {
    task: "scoring",
    primary: { provider: "anthropic", model: "claude-haiku-5-5" },
    fallbacks: [{ provider: "openai", model: "gpt-test" }],
    effort: "low",
    maxOutputTokens: 1000,
    source: "default",
    ...over,
  };
}

const schema = z.object({ score: z.number().min(0).max(100), reason: z.string() });

describe("AI router — provider fallback", () => {
  it("uses the primary model when it succeeds and records cost", async () => {
    const a = provider("anthropic", () => ok('{"score": 80, "reason": "strong"}'));
    const o = provider("openai", () => ok("{}"));
    const events: UsageEvent[] = [];
    const router = createAIRouter({ providers: { anthropic: a.p, openai: o.p }, resolveConfig: () => config(), onUsage: (e) => void events.push(e) });

    const res = await router.generateObject("scoring", { system: "s", messages: [{ role: "user", content: "x" }] }, schema);
    expect(res.data).toEqual({ score: 80, reason: "strong" });
    expect(res.provider).toBe("anthropic");
    expect(o.complete).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ task: "scoring", status: "success", attempt: 1 });
    // haiku 5.5: 1000 × $0.10/M + 200 × $0.50/M = $0.0002
    expect(events[0].costUsd).toBeCloseTo(0.0002, 6);
    // task effort and output cap flow into the request
    expect(a.complete.mock.calls[0][1]).toMatchObject({ effort: "low", maxOutputTokens: 1000 });
  });

  it.each([
    ["rate limit", new AIError("rate_limited", "429")],
    ["outage", new AIError("overloaded", "529")],
    ["refusal", new AIError("refused", "declined")],
    ["network", new AIError("network", "ECONNRESET")],
  ])("falls back to the next model on %s", async (_label, error) => {
    const a = provider("anthropic", () => {
      throw error;
    });
    const o = provider("openai", () => ok('{"score": 55, "reason": "ok"}', "gpt-test"));
    const events: UsageEvent[] = [];
    const router = createAIRouter({ providers: { anthropic: a.p, openai: o.p }, resolveConfig: () => config(), onUsage: (e) => void events.push(e) });

    const res = await router.generateObject("scoring", { system: "s", messages: [] }, schema);
    expect(res.provider).toBe("openai");
    expect(res.attempts.map((x) => x.status)).toEqual([error.kind === "refused" ? "refused" : "error", "success"]);
    expect(events.map((e) => e.status)).toEqual([error.kind === "refused" ? "refused" : "error", "success"]);
    expect(events[1].attempt).toBe(2);
    expect(events[1].costUsd).toBeNull(); // unpriced OpenAI model → null, never a guess
  });

  it("falls back when the output does not match the schema", async () => {
    const a = provider("anthropic", () => ok('{"score": 250}'));
    const o = provider("openai", () => ok('{"score": 10, "reason": "fine"}', "gpt-test"));
    const router = createAIRouter({ providers: { anthropic: a.p, openai: o.p }, resolveConfig: () => config() });
    const res = await router.generateObject("scoring", { system: "s", messages: [] }, schema);
    expect(res.data.score).toBe(10);
    expect(res.attempts[0]).toMatchObject({ status: "error", errorKind: "invalid_output" });
  });

  it("skips providers without credentials (no call, no cost)", async () => {
    const a = provider("anthropic", () => ok("{}"), false);
    const o = provider("openai", () => ok('{"score": 1, "reason": "r"}', "gpt-test"));
    const router = createAIRouter({ providers: { anthropic: a.p, openai: o.p }, resolveConfig: () => config() });
    const res = await router.generateObject("scoring", { system: "s", messages: [] }, schema);
    expect(a.complete).not.toHaveBeenCalled();
    expect(res.attempts[0]).toMatchObject({ provider: "anthropic", status: "skipped" });
  });

  it("reports not_configured when no provider in the chain has a key", async () => {
    const a = provider("anthropic", () => ok("{}"), false);
    const router = createAIRouter({ providers: { anthropic: a.p }, resolveConfig: () => config({ fallbacks: [] }) });
    await expect(router.generateText("scoring", { system: "s", messages: [] })).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("reports all_failed with every attempt when the whole chain fails", async () => {
    const a = provider("anthropic", () => {
      throw new AIError("overloaded", "down");
    });
    const o = provider("openai", () => {
      throw new AIError("auth", "bad key");
    });
    const router = createAIRouter({ providers: { anthropic: a.p, openai: o.p }, resolveConfig: () => config() });
    const err = await router.generateText("scoring", { system: "s", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("all_failed");
    expect(err.attempts.map((x: { errorKind: string }) => x.errorKind)).toEqual(["overloaded", "auth"]);
  });

  it("never lets a failing ledger break the AI call", async () => {
    const a = provider("anthropic", () => ok("hello"));
    const router = createAIRouter({
      providers: { anthropic: a.p },
      resolveConfig: () => config({ fallbacks: [] }),
      onUsage: () => {
        throw new Error("db down");
      },
    });
    await expect(router.generateText("scoring", { system: "s", messages: [] })).resolves.toMatchObject({ data: "hello" });
  });
});

describe("extractJson", () => {
  it("reads plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} — done')).toEqual({ a: 3 });
    expect(() => extractJson("no json here")).toThrow();
  });
});
