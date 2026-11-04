import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/types/database";

import { JOB_PAYLOAD_SCHEMAS, type JobPayload, type JobType } from "./types";

type Db = SupabaseClient<Database>;

export type EnqueueInput<T extends JobType> = {
  projectId: string;
  type: T;
  payload: z.input<(typeof JOB_PAYLOAD_SCHEMAS)[T]>;
  userId: string;
  /** same key → same job (no duplicates from double clicks) */
  idempotencyKey?: string;
  priority?: number;
};

export type EnqueueResult = { ok: true; jobId: string; deduplicated: boolean } | { ok: false; error: string; code?: string };

/**
 * Enqueue a background job as the signed-in user (RLS: editor of the project).
 * Long work (AI calls, fetching) never runs in the request thread.
 */
export async function enqueueJob<T extends JobType>(db: Db, input: EnqueueInput<T>): Promise<EnqueueResult> {
  const parsed = JOB_PAYLOAD_SCHEMAS[input.type].safeParse(input.payload);
  if (!parsed.success) return { ok: false, error: `Invalid job payload: ${z.prettifyError(parsed.error)}` };
  const payload = parsed.data as JobPayload<T>;

  if (input.idempotencyKey) {
    const { data: existing } = await db
      .from("jobs")
      .select("id, status")
      .eq("idempotency_key", input.idempotencyKey)
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (existing) return { ok: true, jobId: existing.id, deduplicated: true };
  }

  const { data, error } = await db
    .from("jobs")
    .insert({
      project_id: input.projectId,
      type: input.type,
      payload: payload as { [key: string]: Json | undefined },
      priority: input.priority ?? 50,
      created_by: input.userId,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // a finished job with the same key exists: allow re-running by dropping the key
    if (error.code === "23505" && input.idempotencyKey) {
      return enqueueJob(db, { ...input, idempotencyKey: undefined });
    }
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: true, jobId: data.id, deduplicated: false };
}
