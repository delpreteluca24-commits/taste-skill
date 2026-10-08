import { z } from "zod";

import type { AITask } from "@/lib/ai/types";

/**
 * Contract of every background job: type → payload schema.
 * The web app enqueues (validated here), the worker re-validates before running.
 * Payload ids are USER INPUT: handlers must always load entities scoped to the
 * job's project (see workers/context.ts → loadOwned).
 */
const uuid = z.uuid();
export const SCRIPT_ANGLES = ["breaking_news", "storytelling", "analysis", "controversy", "unexpected_fact"] as const;
export const SCRIPT_TRANSFORMS = ["regenerate", "shorten", "expand", "rewrite_hook", "change_tone"] as const;

export const JOB_PAYLOAD_SCHEMAS = {
  "connector.fetch": z.object({ connectorId: uuid }),
  "trends.detect": z.object({ sinceHours: z.number().int().min(1).max(168).default(48) }),
  "opportunity.ai_score": z.object({
    opportunityIds: z.array(uuid).min(1).max(50),
    /** cost the user accepted when above the batch limit (USD) */
    confirmedCostUsd: z.number().min(0).optional(),
  }),
  "research.suggest": z.object({ opportunityId: uuid }),
  "factcheck.assist": z.object({ factId: uuid }),
  "script.generate": z.object({ storyId: uuid, angles: z.array(z.enum(SCRIPT_ANGLES)).min(1).max(5) }),
  "hooks.generate": z.object({ storyId: uuid, count: z.number().int().min(5).max(10).default(5) }),
  "script.transform": z.object({
    scriptId: uuid,
    operation: z.enum(SCRIPT_TRANSFORMS),
    tone: z.string().trim().max(60).optional(),
  }),
} as const;

export type JobType = keyof typeof JOB_PAYLOAD_SCHEMAS;
export type JobPayload<T extends JobType> = z.infer<(typeof JOB_PAYLOAD_SCHEMAS)[T]>;
export const JOB_TYPES = Object.keys(JOB_PAYLOAD_SCHEMAS) as JobType[];

export const JOB_LABELS: Record<JobType, string> = {
  "connector.fetch": "Fetch source",
  "trends.detect": "Detect trends",
  "opportunity.ai_score": "AI scoring",
  "research.suggest": "Research suggestions",
  "factcheck.assist": "Fact-check assist",
  "script.generate": "Generate scripts",
  "hooks.generate": "Generate hooks",
  "script.transform": "Rewrite script",
};

/** which AI task (→ model) a job uses; jobs without AI are absent */
export const JOB_AI_TASK: Partial<Record<JobType, AITask>> = {
  "trends.detect": "discovery",
  "opportunity.ai_score": "scoring",
  "research.suggest": "research",
  "factcheck.assist": "fact_check",
  "script.generate": "script",
  "hooks.generate": "script",
  "script.transform": "script",
};

export function isJobType(value: unknown): value is JobType {
  return typeof value === "string" && Object.hasOwn(JOB_PAYLOAD_SCHEMAS, value);
}

export const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;
