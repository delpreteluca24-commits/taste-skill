import { z } from "zod";

import { costFor } from "./pricing";
import {
  AIError,
  EMPTY_USAGE,
  type AICallResult,
  type AIProvider,
  type AIProviderId,
  type AIRequest,
  type AIResult,
  type AITask,
  type AttemptRecord,
  type ModelRef,
  type TaskModelConfig,
  type UsageEvent,
} from "./types";

export type AIRouterOptions = {
  providers: Partial<Record<AIProviderId, AIProvider>>;
  resolveConfig: (task: AITask) => TaskModelConfig;
  /** persists every real call (ledger); failures here never break the AI call */
  onUsage?: (event: UsageEvent) => void | Promise<void>;
};

export type AIRouter = {
  generateText(task: AITask, request: AIRequest): Promise<AIResult<string>>;
  generateObject<T>(task: AITask, request: AIRequest, schema: z.ZodType<T>): Promise<AIResult<T>>;
  config(task: AITask): TaskModelConfig;
};

/** Extract a JSON value from model text (tolerates ```json fences and leading prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("no JSON found in model output");
  }
}

/**
 * Routes a task through its model chain: primary → fallbacks.
 * - unconfigured providers are skipped (no call, no cost)
 * - any failure (rate limit, outage, refusal, invalid output, auth) moves to the next model
 * - every real call is reported to onUsage with tokens and cost
 * - when the whole chain fails, AIError('all_failed') carries every attempt
 */
export function createAIRouter(options: AIRouterOptions): AIRouter {
  async function run<T>(task: AITask, request: AIRequest, parse: (call: AICallResult) => T, schema?: z.ZodType) {
    const cfg = options.resolveConfig(task);
    const chain: ModelRef[] = [cfg.primary, ...cfg.fallbacks];
    const attempts: AttemptRecord[] = [];
    let attemptNo = 0;

    for (const ref of chain) {
      const provider = options.providers[ref.provider];
      if (!provider || !provider.isConfigured()) {
        attempts.push({ provider: ref.provider, model: ref.model, status: "skipped", message: "provider not configured" });
        continue;
      }
      attemptNo += 1;
      const req: AIRequest = {
        ...request,
        effort: request.effort ?? cfg.effort,
        maxOutputTokens: request.maxOutputTokens ?? cfg.maxOutputTokens,
      };
      let call: AICallResult | null = null;
      try {
        call = await provider.complete(ref.model, req, schema);
        const data = parse(call);
        const costUsd = costFor(call.servedModel || ref.model, call.usage);
        await report({
          task,
          provider: ref.provider,
          model: call.servedModel || ref.model,
          attempt: attemptNo,
          status: "success",
          usage: call.usage,
          costUsd,
          latencyMs: call.latencyMs,
        });
        attempts.push({ provider: ref.provider, model: ref.model, status: "success" });
        return { data, provider: ref.provider, model: call.servedModel || ref.model, usage: call.usage, costUsd, attempts };
      } catch (e) {
        const err =
          e instanceof AIError
            ? e
            : new AIError("invalid_output", e instanceof Error ? e.message : "invalid output", {
                provider: ref.provider,
                model: ref.model,
                cause: e,
              });
        const usage = call?.usage ?? EMPTY_USAGE;
        await report({
          task,
          provider: ref.provider,
          model: call?.servedModel || ref.model,
          attempt: attemptNo,
          status: err.kind === "refused" ? "refused" : "error",
          errorCode: err.kind,
          usage,
          costUsd: call ? costFor(call.servedModel || ref.model, usage) : null,
          latencyMs: call?.latencyMs ?? null,
        });
        attempts.push({
          provider: ref.provider,
          model: ref.model,
          status: err.kind === "refused" ? "refused" : "error",
          errorKind: err.kind,
          message: err.message.slice(0, 300),
        });
      }
    }

    if (attempts.every((a) => a.status === "skipped")) {
      throw new AIError(
        "not_configured",
        `No AI provider is configured for the "${task}" task. Add an API key or change the task model in Settings.`,
        { attempts },
      );
    }
    throw new AIError("all_failed", `All models failed for the "${task}" task`, { attempts });
  }

  async function report(event: UsageEvent) {
    if (!options.onUsage) return;
    try {
      await options.onUsage(event);
    } catch {
      // the ledger must never break the AI call itself
    }
  }

  return {
    config: options.resolveConfig,
    generateText(task, request) {
      return run(task, request, (call) => call.text);
    },
    generateObject<T>(task: AITask, request: AIRequest, schema: z.ZodType<T>) {
      return run(
        task,
        request,
        (call) => {
          const parsed = schema.safeParse(extractJson(call.text));
          if (!parsed.success) {
            throw new AIError("invalid_output", `Model output failed validation: ${z.prettifyError(parsed.error).slice(0, 500)}`);
          }
          return parsed.data;
        },
        schema,
      );
    },
  };
}
