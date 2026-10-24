"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type JobStatusView = {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  result: unknown;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
};

/** Polled by <JobStatus>; RLS limits it to jobs of the user's projects. */
export async function getJobStatus(jobId: string): Promise<JobStatusView | null> {
  await requireUser();
  if (!z.uuid().safeParse(jobId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, type, status, error_message, result, attempts, created_at, finished_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    type: data.type,
    status: data.status,
    errorMessage: data.error_message,
    result: data.result,
    attempts: data.attempts,
    createdAt: data.created_at,
    finishedAt: data.finished_at,
  };
}

export async function cancelJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!z.uuid().safeParse(jobId).success) return { ok: false, error: "Invalid job" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_job", { p_job_id: jobId });
  return error ? { ok: false, error: "Only pending jobs can be cancelled." } : { ok: true };
}
