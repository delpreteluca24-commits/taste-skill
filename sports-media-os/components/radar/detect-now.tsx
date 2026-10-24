"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { detectTrendsNowAction } from "@/lib/radar/actions";

/**
 * "Detect now": queues trends.detect (48h window) for the background worker
 * and follows it with <JobStatus>, which refreshes the board when it ends.
 * Detection also runs automatically after each connector fetch.
 */
export function DetectNow({ activeJobId, canEdit }: { activeJobId: string | null; canEdit: boolean }) {
  const [jobId, setJobId] = useState<string | null>(activeJobId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const detect = () =>
    startTransition(async () => {
      setError(null);
      const result = await detectTrendsNowAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJobId(result.data.jobId);
    });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="detect-now">
      {jobId ? <JobStatus key={jobId} jobId={jobId} label="Trend detection" /> : null}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={detect}
        disabled={!canEdit || pending}
        title={canEdit ? "Cluster the last 48h of sources into trends now (background job)" : "Project editors can run detection"}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        Detect now
      </Button>
    </div>
  );
}
