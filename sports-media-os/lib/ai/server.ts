import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

import { resolveTaskConfig, type TaskOverride } from "./models";
import { createAnthropicProvider } from "./providers/anthropic";
import { createOpenAIProvider } from "./providers/openai";
import { createAIRouter, type AIRouter } from "./router";
import type { AITask } from "./types";

type Db = SupabaseClient<Database>;

export type ServerAIOptions = {
  /** service-role client (workers): writes the ai_usage ledger */
  db: Db;
  projectId: string | null;
  jobId?: string | null;
  agentRunId?: string | null;
  /** per-task overrides from Settings (workspace `ai.tasks`) */
  taskOverrides?: Partial<Record<AITask, TaskOverride>>;
};

/**
 * Router wired to real providers (keys from server env) and to the ai_usage
 * ledger. Used by workers; web requests enqueue jobs instead of calling models.
 */
export function createServerAI(options: ServerAIOptions): AIRouter {
  return createAIRouter({
    providers: { anthropic: createAnthropicProvider(), openai: createOpenAIProvider() },
    resolveConfig: (task) => resolveTaskConfig(task, options.taskOverrides?.[task]),
    onUsage: async (event) => {
      const { error } = await options.db.from("ai_usage").insert({
        project_id: options.projectId,
        task: event.task,
        provider: event.provider,
        model: event.model,
        job_id: options.jobId ?? null,
        agent_run_id: options.agentRunId ?? null,
        attempt: Math.min(event.attempt, 10),
        status: event.status,
        error_code: event.errorCode ?? null,
        input_tokens: event.usage.inputTokens,
        output_tokens: event.usage.outputTokens,
        cache_read_tokens: event.usage.cacheReadTokens,
        cache_write_tokens: event.usage.cacheWriteTokens,
        cost_usd: event.costUsd,
        latency_ms: event.latencyMs,
      });
      if (error) logger.warn("ai.usage_ledger_failed", { code: error.code, message: error.message });
      logger.info("ai.call", {
        task: event.task,
        provider: event.provider,
        model: event.model,
        status: event.status,
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
      });
    },
  });
}
