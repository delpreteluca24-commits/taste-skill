"use client";

import { useCallback, useState, useTransition } from "react";

import type { ActionResult } from "@/lib/actions";
import type { JobStatusView } from "@/lib/jobs/actions";
import type { QueuedJob } from "@/lib/scripts/actions";

/**
 * Queue an AI job and follow it with <JobStatus>. The model never runs in the
 * request: the worker picks the job up and the page refreshes when it is done.
 * `describe` turns a completed job's result into a one-line outcome.
 */
export function useQueuedJob(initialJobId: string | null, describe?: (result: unknown) => string | null) {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onDone = useCallback(
    (job: JobStatusView) => {
      setFinished(true);
      if (job.status === "completed" && describe) setNote(describe(job.result));
    },
    [describe],
  );

  function queue(fn: () => Promise<ActionResult<QueuedJob>>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setFinished(false);
      setJobId(res.data.jobId);
      setNote(res.message ?? null);
    });
  }

  return { jobId, running: jobId !== null && !finished, note, error, pending, queue, onDone };
}

/* ------------------------------------------------------------------------- */
/* job outcomes (results are read defensively: they come from the jobs table) */
/* ------------------------------------------------------------------------- */

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** script.generate → "2 versions written. Not written: analysis (…)." */
export function describeGenerateResult(result: unknown): string | null {
  const r = record(result);
  const created = list(r.created).length;
  const failed = list(r.failed).map(record);
  const warned = list(r.created)
    .map(record)
    .filter((c) => Number(c.warnings ?? 0) > 0).length;
  const parts = [`${created} version${created === 1 ? "" : "s"} written`];
  if (warned) parts.push(`${warned} with warnings to check`);
  let text = `${parts.join(", ")}.`;
  if (failed.length) text += ` Not written: ${failed.map((f) => `${String(f.angle ?? "?").replace(/_/g, " ")} (${String(f.error ?? "error").slice(0, 80)})`).join("; ")}.`;
  return text;
}

/** hooks.generate → "5 hooks across 5 types." */
export function describeHooksResult(result: unknown): string | null {
  const r = record(result);
  const inserted = Number(r.inserted ?? 0);
  const types = Number(r.distinctTypes ?? 0);
  const dropped = record(r.dropped);
  const skipped = Number(dropped.duplicates ?? 0) + Number(dropped.discarded ?? 0);
  return `${inserted} hook${inserted === 1 ? "" : "s"} across ${types} type${types === 1 ? "" : "s"}${skipped ? ` (${skipped} repeated or unusable skipped)` : ""}.`;
}

/** script.transform → "Version 7 written (2 warnings to check). Make it current to use it." */
export function describeTransformResult(result: unknown): string | null {
  const r = record(result);
  if (typeof r.version !== "number") return null;
  const w = Number(r.warnings ?? 0);
  const checks = w ? ` (${w} warning${w === 1 ? "" : "s"} to check)` : "";
  return r.isCurrent === true ? `Version ${r.version} written and made current${checks}.` : `Version ${r.version} written${checks}. Make it current to use it.`;
}
