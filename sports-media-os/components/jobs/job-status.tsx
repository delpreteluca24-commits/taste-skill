"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getJobStatus, type JobStatusView } from "@/lib/jobs/actions";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * Shows a background job's progress and refreshes the page when it finishes.
 * Polls every 2s while pending/running (the worker does the actual work).
 */
export function JobStatus({
  jobId,
  label,
  onDone,
}: {
  jobId: string;
  label?: string;
  onDone?: (job: JobStatusView) => void;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobStatusView | null>(null);
  // latest callback without restarting polling when the parent re-renders
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      let next: JobStatusView | null;
      try {
        next = await getJobStatus(jobId);
      } catch {
        // transient (network / server restart): try again a bit later
        if (!cancelled) timer = setTimeout(tick, 5000);
        return;
      }
      if (cancelled) return;
      setJob(next);
      if (next && TERMINAL.has(next.status)) {
        if (!done) {
          done = true;
          onDoneRef.current?.(next);
          router.refresh();
        }
        return;
      }
      timer = setTimeout(tick, 2000);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router]);

  const status = job?.status ?? "pending";
  const view = {
    pending: { variant: "outline" as const, icon: Clock, text: "Queued — waiting for the worker" },
    running: { variant: "info" as const, icon: Loader2, text: "Running" },
    completed: { variant: "success" as const, icon: CheckCircle2, text: "Done" },
    failed: { variant: "danger" as const, icon: XCircle, text: "Failed" },
    cancelled: { variant: "outline" as const, icon: XCircle, text: "Cancelled" },
  }[status];
  const Icon = view.icon;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="status" data-testid="job-status" data-status={status}>
      <Badge variant={view.variant}>
        <Icon className={status === "running" ? "animate-spin" : undefined} />
        {label ? `${label}: ` : ""}
        {view.text}
      </Badge>
      {job?.status === "failed" && job.errorMessage ? (
        <span className="text-danger">{job.errorMessage.slice(0, 240)}</span>
      ) : null}
    </div>
  );
}
