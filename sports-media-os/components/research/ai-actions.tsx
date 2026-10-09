"use client";

import { useCallback, useState, useTransition } from "react";
import { Bot, CheckCheck, Loader2 } from "lucide-react";

import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { applyClaimSuggestionAction, requestFactCheckAction, requestResearchSuggestionsAction } from "@/lib/research/actions";

import { InlineResult, toFormData, useInlineAction } from "./form-kit";

type QueueResult = ReturnType<typeof requestResearchSuggestionsAction>;

/**
 * Queue an AI job and follow it with <JobStatus>. The model never runs in this
 * request: the worker picks the job up and the page refreshes when it is done.
 */
function useQueuedJob(initialJobId: string | null) {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // stable: <JobStatus> re-subscribes when its callback changes
  const onDone = useCallback(() => setFinished(true), []);

  function queue(fn: () => QueueResult) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      setError(null);
      setFinished(false);
      setJobId(res.data.jobId);
      setNote(res.data.deduplicated ? (res.message ?? "Already queued.") : null);
    });
  }
  return { jobId, running: jobId !== null && !finished, note, error, pending, queue, onDone };
}

/** "AI: suggest research" (RESEARCH task, Researcher agent). */
export function SuggestResearchButton({
  opportunityId,
  activeJobId,
  sourceCount,
}: {
  opportunityId: string;
  /** a research.suggest job still pending/running for this opportunity */
  activeJobId: string | null;
  sourceCount: number;
}) {
  const { jobId, running, note, error, pending, queue, onDone } = useQueuedJob(activeJobId);
  return (
    <div className="grid gap-2" data-testid="ai-suggest-research">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || running}
          onClick={() => queue(() => requestResearchSuggestionsAction(opportunityId))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Bot />}
          AI: suggest research
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {sourceCount === 0
            ? "No sources yet: the AI can only suggest questions. Add sources for claims and a timeline."
            : `Reads the opportunity and the ${sourceCount} workspace source${sourceCount === 1 ? "" : "s"} (titles and summaries). Runs in the background.`}
        </span>
      </div>
      {jobId ? (
        <div className="grid gap-1">
          <JobStatus key={jobId} jobId={jobId} label="Research suggestions" onDone={onDone} />
          {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Ask AI to assess" (FACT_CHECK task, Fact Checker agent). The result is a suggestion only. */
export function AssessClaimButton({
  factId,
  activeJobId,
  disabledReason,
}: {
  factId: string;
  activeJobId: string | null;
  /** e.g. no linked sources yet */
  disabledReason: string | null;
}) {
  const { jobId, running, error, pending, queue, onDone } = useQueuedJob(activeJobId);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={pending || running || Boolean(disabledReason)}
          title={disabledReason ?? "Runs in the background on the fact-check model"}
          onClick={() => queue(() => requestFactCheckAction(factId))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Bot />}
          Ask AI to assess
        </Button>
        {disabledReason ? <span className="text-[11px] text-muted-foreground">{disabledReason}</span> : null}
      </div>
      {jobId ? <JobStatus key={jobId} jobId={jobId} label="Fact-check assist" onDone={onDone} /> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Apply the stored AI suggestion with one click — through the normal status update and DB rules. */
export function ApplySuggestionButton({ factId, disabledReason }: { factId: string; disabledReason: string | null }) {
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant="brand"
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason ?? "Sets the suggested status and confidence as your verification"}
        onClick={() => run(() => applyClaimSuggestionAction(null, toFormData({ factId })))}
      >
        {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}
        Apply suggestion
      </Button>
      <InlineResult state={state} />
    </span>
  );
}
