import type { SupabaseClient } from "@supabase/supabase-js";

import type { AgentKey } from "@/agents/registry";
import { createServerAI } from "@/lib/ai/server";
import type { AIRouter } from "@/lib/ai/router";
import type { JobPayload, JobType } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { aiSettingsSchema } from "@/lib/settings/schema";
import type { Database, Json } from "@/types/database";

export type Db = SupabaseClient<Database>;
export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type PublicTables = Database["public"]["Tables"];
/** tables that carry project_id and an id */
export type OwnedTable = {
  [K in keyof PublicTables]: PublicTables[K]["Row"] extends { id: string; project_id: string } ? K : never;
}[keyof PublicTables];

/** Bad input (missing/foreign entity, invalid state): fail the job without retrying. */
export class JobInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobInputError";
  }
}

export type JobContext = {
  /** service-role client — bypasses RLS: ALWAYS scope queries with projectId */
  db: Db;
  job: JobRow;
  projectId: string;
  log: (event: string, fields?: Record<string, unknown>) => void;
  /** AI router for this job: per-task models from Settings, usage written to ai_usage */
  ai: (opts?: { agentRunId?: string }) => Promise<AIRouter>;
  /** load a row by id that MUST belong to the job's project (throws JobInputError otherwise) */
  loadOwned: <T extends OwnedTable>(table: T, id: string) => Promise<PublicTables[T]["Row"]>;
  /** record an agent run (Agent Center) around a unit of work */
  withAgentRun: <R>(
    agent: AgentKey,
    input: Json,
    fn: (runId: string) => Promise<{ result: R; output?: Json }>,
  ) => Promise<R>;
  /** append to activity_logs as the agent/system */
  activity: (entry: {
    agent?: AgentKey;
    action: string;
    entityType?: string;
    entityId?: string;
    status?: "info" | "success" | "warning" | "failed";
    metadata?: Json;
  }) => Promise<void>;
};

export type JobHandler<T extends JobType> = {
  type: T;
  run: (ctx: JobContext, payload: JobPayload<T>) => Promise<Json | void>;
};

export function defineHandler<T extends JobType>(handler: JobHandler<T>): JobHandler<T> {
  return handler;
}

async function loadAIOverrides(db: Db) {
  const { data } = await db.from("settings").select("value").is("project_id", null).eq("key", "ai").maybeSingle();
  const parsed = aiSettingsSchema.safeParse(data?.value ?? {});
  return parsed.success ? parsed.data : aiSettingsSchema.parse({});
}

export function createJobContext(db: Db, job: JobRow): JobContext {
  if (!job.project_id) throw new JobInputError("job has no project");
  const projectId = job.project_id;
  const log = (event: string, fields?: Record<string, unknown>) =>
    logger.info(event, { jobId: job.id, jobType: job.type, projectId, ...fields });

  return {
    db,
    job,
    projectId,
    log,
    async ai(opts) {
      const settings = await loadAIOverrides(db);
      return createServerAI({
        db,
        projectId,
        jobId: job.id,
        agentRunId: opts?.agentRunId ?? null,
        taskOverrides: settings.tasks,
      });
    },
    async loadOwned(table, id) {
      const { data, error } = await db
        .from(table)
        .select("*")
        .eq("id" as never, id as never)
        .eq("project_id" as never, projectId as never)
        .maybeSingle();
      if (error) throw new Error(`${String(table)} lookup failed: ${error.message}`);
      if (!data) throw new JobInputError(`${String(table)} ${id} not found in this project`);
      return data as never;
    },
    async withAgentRun(agent, input, fn) {
      const { data: run, error } = await db
        .from("agent_runs")
        .insert({
          project_id: projectId,
          agent,
          status: "running",
          triggered_by: "manual",
          input_ref: input ?? {},
          started_at: new Date().toISOString(),
          created_by: job.created_by,
        })
        .select("id")
        .single();
      if (error || !run) throw new Error(`agent run could not start: ${error?.message}`);
      try {
        const { result, output } = await fn(run.id);
        await db
          .from("agent_runs")
          .update({ status: "completed", output_ref: output ?? {}, finished_at: new Date().toISOString() })
          .eq("id", run.id);
        return result;
      } catch (e) {
        await db
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
            finished_at: new Date().toISOString(),
          })
          .eq("id", run.id);
        throw e;
      }
    },
    async activity(entry) {
      const { error } = await db.from("activity_logs").insert({
        project_id: projectId,
        actor_type: entry.agent ? "agent" : "system",
        agent: entry.agent ?? null,
        action: entry.action,
        entity_type: entry.entityType ?? null,
        entity_id: entry.entityId ?? null,
        status: entry.status ?? "info",
        metadata: entry.metadata ?? {},
      });
      if (error) logger.warn("worker.activity_log_failed", { message: error.message });
    },
  };
}
