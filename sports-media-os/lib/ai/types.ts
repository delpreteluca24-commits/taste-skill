import type { z } from "zod";

/**
 * Provider-agnostic AI contracts. Features depend on these types and on the
 * router (lib/ai/router.ts) — never on a vendor SDK directly.
 */

export const AI_TASKS = ["discovery", "scoring", "research", "script", "fact_check"] as const;
export type AITask = (typeof AI_TASKS)[number];

export const AI_PROVIDER_IDS = ["anthropic", "openai"] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type ModelRef = { provider: AIProviderId; model: string };

/** Resolved routing for one task: primary model, ordered fallbacks, effort, output cap. */
export type TaskModelConfig = {
  task: AITask;
  primary: ModelRef;
  fallbacks: ModelRef[];
  effort: Effort;
  maxOutputTokens: number;
  /** where the primary came from — shown in Settings so routing is never a mystery */
  source: "settings" | "env" | "default";
};

export type AIMessage = { role: "user" | "assistant"; content: string };

export type AIRequest = {
  system: string;
  messages: AIMessage[];
  maxOutputTokens?: number;
  effort?: Effort;
  /** mark the system prompt cacheable (stable prompts reused across a batch) */
  cacheSystemPrompt?: boolean;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AICallResult = {
  text: string;
  usage: AIUsage;
  /** model that actually served the request (may differ after a server-side fallback) */
  servedModel: string;
  latencyMs: number;
  stopReason: string | null;
};

export interface AIProvider {
  readonly id: AIProviderId;
  isConfigured(): boolean;
  /** One call. `schema` asks the provider for structured JSON matching it; the router validates again. */
  complete(model: string, request: AIRequest, schema?: z.ZodType): Promise<AICallResult>;
}

export type AIErrorKind =
  | "not_configured"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "network"
  | "auth"
  | "bad_request"
  | "refused"
  | "truncated"
  | "invalid_output"
  | "all_failed"
  | "unknown";

export class AIError extends Error {
  readonly kind: AIErrorKind;
  readonly provider?: AIProviderId;
  readonly model?: string;
  readonly status?: number;
  readonly attempts?: AttemptRecord[];

  constructor(
    kind: AIErrorKind,
    message: string,
    opts: { provider?: AIProviderId; model?: string; status?: number; attempts?: AttemptRecord[]; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "AIError";
    this.kind = kind;
    this.provider = opts.provider;
    this.model = opts.model;
    this.status = opts.status;
    this.attempts = opts.attempts;
  }
}

export type AttemptRecord = {
  provider: AIProviderId;
  model: string;
  status: "success" | "error" | "refused" | "skipped";
  errorKind?: AIErrorKind;
  message?: string;
};

/** Emitted once per real model call (success or failure) → ai_usage ledger. */
export type UsageEvent = {
  task: AITask;
  provider: AIProviderId;
  model: string;
  attempt: number;
  status: "success" | "error" | "refused";
  errorCode?: AIErrorKind;
  usage: AIUsage;
  costUsd: number | null;
  latencyMs: number | null;
};

export type AIResult<T> = {
  data: T;
  provider: AIProviderId;
  model: string;
  usage: AIUsage;
  costUsd: number | null;
  attempts: AttemptRecord[];
};

export const EMPTY_USAGE: AIUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
