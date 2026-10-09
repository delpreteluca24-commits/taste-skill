import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { AIError, type AICallResult, type AIErrorKind, type AIProvider, type AIRequest } from "../types";

/** Models that accept server-side refusal fallback (`fallbacks: "default"`). Haiku 5.5 does not. */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Current-generation models take `output_config.effort` (thinking is adaptive by default). */
const EFFORT_MODEL = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;

export type AnthropicProviderOptions = {
  apiKey?: string;
  /** injected in tests */
  client?: Pick<Anthropic, "beta">;
  timeoutMs?: number;
};

export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): AIProvider {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  let client = opts.client ?? null;

  function getClient() {
    if (!client) {
      // SDK retries 429/5xx once; the router then moves to the next model in the chain
      client = new Anthropic({ apiKey, maxRetries: 1, timeout: opts.timeoutMs ?? 120_000 });
    }
    return client;
  }

  return {
    id: "anthropic",
    isConfigured: () => Boolean(opts.client || apiKey),
    async complete(model: string, request: AIRequest, schema?: z.ZodType): Promise<AICallResult> {
      const started = Date.now();
      const serverFallback = SERVER_FALLBACK_MODELS.has(model);
      const outputConfig: Record<string, unknown> = {};
      if (request.effort && EFFORT_MODEL.test(model)) outputConfig.effort = request.effort;
      if (schema) outputConfig.format = { type: "json_schema", schema: zodOutputFormat(schema).schema };

      try {
        const response = await getClient().beta.messages.create({
          model,
          max_tokens: request.maxOutputTokens ?? 8_000,
          system: request.cacheSystemPrompt
            ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
            : request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
          ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });

        const usage = {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        };
        const text = response.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("");

        if (response.stop_reason === "refusal") {
          throw Object.assign(new AIError("refused", "The model declined this request", { provider: "anthropic", model }), {
            usage,
          });
        }
        if (response.stop_reason === "max_tokens" && schema) {
          throw new AIError("truncated", "Output hit max_tokens before the JSON was complete", { provider: "anthropic", model });
        }
        return {
          text,
          usage,
          servedModel: response.model ?? model,
          latencyMs: Date.now() - started,
          stopReason: response.stop_reason ?? null,
        };
      } catch (e) {
        throw toAIError(e, model);
      }
    },
  };
}

function toAIError(e: unknown, model: string): AIError {
  if (e instanceof AIError) return e;
  const kind: AIErrorKind =
    e instanceof Anthropic.RateLimitError
      ? "rate_limited"
      : e instanceof Anthropic.APIConnectionTimeoutError
        ? "timeout"
        : e instanceof Anthropic.APIConnectionError
          ? "network"
          : e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
            ? "auth"
            : e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError
              ? "bad_request"
              : e instanceof Anthropic.InternalServerError
                ? "overloaded"
                : "unknown";
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const message = e instanceof Error ? e.message : String(e);
  return new AIError(kind, message.slice(0, 500), { provider: "anthropic", model, status, cause: e });
}
