import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createOpenAIProvider } from "@/lib/ai/providers/openai";
import { AIError } from "@/lib/ai/types";

function anthropicClient(response: unknown) {
  const create = vi.fn(async () => response);
  return { client: { beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">, create };
}

const msg = (over: Record<string, unknown> = {}) => ({
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: '{"ok":true}' }],
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
  ...over,
});

describe("AnthropicProvider", () => {
  it("sends effort + JSON schema and opts into server-side refusal fallback on Sonnet 5.5", async () => {
    const { client, create } = anthropicClient(msg());
    const p = createAnthropicProvider({ client });
    const res = await p.complete(
      "claude-sonnet-5-5",
      { system: "sys", messages: [{ role: "user", content: "hi" }], effort: "medium", maxOutputTokens: 500, cacheSystemPrompt: true },
      z.object({ ok: z.boolean() }),
    );
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 500,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(params.system).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
    expect(params).not.toHaveProperty("thinking"); // adaptive by default on 5.x; never disabled
    expect(res).toMatchObject({ text: '{"ok":true}', servedModel: "claude-sonnet-5-5" });
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 50, cacheWriteTokens: 0 });
  });

  it("does not send server fallbacks for Haiku 5.5 (unsupported there)", async () => {
    const { client, create } = anthropicClient(msg({ model: "claude-haiku-5-5" }));
    await createAnthropicProvider({ client }).complete("claude-haiku-5-5", { system: "s", messages: [], effort: "low" });
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect(params).toMatchObject({ output_config: { effort: "low" } });
  });

  it("turns a refusal stop_reason into a 'refused' AIError (router then falls back)", async () => {
    const { client } = anthropicClient(msg({ stop_reason: "refusal", content: [] }));
    const err = await createAnthropicProvider({ client })
      .complete("claude-sonnet-5-5", { system: "s", messages: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("refused");
  });

  it("flags truncated structured output", async () => {
    const { client } = anthropicClient(msg({ stop_reason: "max_tokens" }));
    const err = await createAnthropicProvider({ client })
      .complete("claude-sonnet-5-5", { system: "s", messages: [] }, z.object({ ok: z.boolean() }))
      .catch((e) => e);
    expect(err.kind).toBe("truncated");
  });

  it("maps SDK errors to typed AIError kinds", async () => {
    const create = vi.fn(async () => {
      throw new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    });
    const client = { beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">;
    const err = await createAnthropicProvider({ client }).complete("claude-haiku-5-5", { system: "s", messages: [] }).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited", provider: "anthropic", status: 429 });
  });

  it("is not configured without an API key", () => {
    expect(createAnthropicProvider({ apiKey: "" }).isConfigured()).toBe(false);
  });
});

describe("OpenAIProvider", () => {
  function openaiClient(response: unknown) {
    const create = vi.fn(async () => response);
    return { client: { chat: { completions: { create } } } as unknown as Pick<OpenAI, "chat">, create };
  }

  it("sends a json_schema response format and reports cached tokens separately", async () => {
    const { client, create } = openaiClient({
      model: "gpt-test",
      choices: [{ message: { content: '{"ok":true}', refusal: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } },
    });
    const res = await createOpenAIProvider({ client }).complete(
      "gpt-test",
      { system: "sys", messages: [{ role: "user", content: "x" }], maxOutputTokens: 300 },
      z.object({ ok: z.boolean() }),
    );
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params).toMatchObject({
      model: "gpt-test",
      max_completion_tokens: 300,
      response_format: { type: "json_schema" },
    });
    expect((params.messages as { role: string }[])[0].role).toBe("system");
    expect(res.usage).toEqual({ inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0 });
  });

  it("maps refusals and SDK errors", async () => {
    const { client } = openaiClient({
      model: "gpt-test",
      choices: [{ message: { content: null, refusal: "no" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });
    expect(await createOpenAIProvider({ client }).complete("gpt-test", { system: "s", messages: [] }).catch((e) => e.kind)).toBe("refused");

    const create = vi.fn(async () => {
      throw new OpenAI.AuthenticationError(401, { message: "bad key" }, "bad key", new Headers());
    });
    const failing = { chat: { completions: { create } } } as unknown as Pick<OpenAI, "chat">;
    expect(await createOpenAIProvider({ client: failing }).complete("gpt-test", { system: "s", messages: [] }).catch((e) => e.kind)).toBe("auth");
  });
});
