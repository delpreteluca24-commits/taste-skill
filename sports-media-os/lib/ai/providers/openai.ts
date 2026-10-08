import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

import { AIError, type AICallResult, type AIErrorKind, type AIProvider, type AIRequest } from "../types";

export type OpenAIProviderOptions = {
  apiKey?: string;
  /** injected in tests */
  client?: Pick<OpenAI, "chat">;
  timeoutMs?: number;
};

/**
 * OpenAI Chat Completions provider. Structured output via json_schema
 * response_format; the router re-validates every result with zod anyway.
 */
export function createOpenAIProvider(opts: OpenAIProviderOptions = {}): AIProvider {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  let client = opts.client ?? null;

  function getClient() {
    if (!client) client = new OpenAI({ apiKey, maxRetries: 1, timeout: opts.timeoutMs ?? 120_000 });
    return client;
  }

  return {
    id: "openai",
    isConfigured: () => Boolean(opts.client || apiKey),
    async complete(model: string, request: AIRequest, schema?: z.ZodType): Promise<AICallResult> {
      const started = Date.now();
      try {
        const response = await getClient().chat.completions.create({
          model,
          max_completion_tokens: request.maxOutputTokens ?? 8_000,
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          ...(schema ? { response_format: zodResponseFormat(schema, "output") } : {}),
        });

        const choice = response.choices[0];
        const usage = {
          inputTokens: Math.max(
            0,
            (response.usage?.prompt_tokens ?? 0) - (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          ),
          outputTokens: response.usage?.completion_tokens ?? 0,
          cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        };
        if (choice?.message?.refusal) {
          throw new AIError("refused", "The model declined this request", { provider: "openai", model });
        }
        if (choice?.finish_reason === "length" && schema) {
          throw new AIError("truncated", "Output hit the token limit before the JSON was complete", {
            provider: "openai",
            model,
          });
        }
        return {
          text: choice?.message?.content ?? "",
          usage,
          servedModel: response.model ?? model,
          latencyMs: Date.now() - started,
          stopReason: choice?.finish_reason ?? null,
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
    e instanceof OpenAI.RateLimitError
      ? "rate_limited"
      : e instanceof OpenAI.APIConnectionTimeoutError
        ? "timeout"
        : e instanceof OpenAI.APIConnectionError
          ? "network"
          : e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError
            ? "auth"
            : e instanceof OpenAI.BadRequestError || e instanceof OpenAI.NotFoundError
              ? "bad_request"
              : e instanceof OpenAI.InternalServerError
                ? "overloaded"
                : "unknown";
  const status = e instanceof OpenAI.APIError ? e.status : undefined;
  const message = e instanceof Error ? e.message : String(e);
  return new AIError(kind, message.slice(0, 500), { provider: "openai", model, status, cause: e });
}
