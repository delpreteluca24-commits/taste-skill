"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2, TriangleAlert } from "lucide-react";

import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { formatUsd, type BatchCostEstimate } from "@/lib/opportunities/ai-cost";
import { requestAIScoring } from "@/lib/opportunities/actions";

type State =
  | { kind: "idle" }
  | { kind: "confirm"; estimate: BatchCostEstimate; reason: "above_limit" | "unpriced" | "estimate_changed" }
  | { kind: "queued"; jobId: string; estimate: BatchCostEstimate; deduplicated: boolean }
  | { kind: "error"; message: string };

function describe(e: BatchCostEstimate) {
  return `${e.calls} call${e.calls === 1 ? "" : "s"} on ${e.model} · up to ${formatUsd(e.usd)} (limit ${formatUsd(e.limitUsd)}, prices as of ${e.pricesAsOf})`;
}

/**
 * Queues AI scoring (SCORING task) for the given opportunities. The server
 * estimates the batch cost first; above the Settings limit (or for an unpriced
 * model) the user must confirm the shown estimate before anything runs.
 */
export function AIScoreButton({ ids, label = "AI score", disabled }: { ids: string[]; label?: string; disabled?: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function run(confirmedCostUsd?: number) {
    startTransition(async () => {
      const res = await requestAIScoring(ids, confirmedCostUsd);
      if (!res.ok) return setState({ kind: "error", message: res.error });
      if (res.data.status === "needs_confirmation") {
        return setState({ kind: "confirm", estimate: res.data.estimate, reason: res.data.reason });
      }
      setState({ kind: "queued", jobId: res.data.jobId, estimate: res.data.estimate, deduplicated: res.data.deduplicated });
    });
  }

  return (
    <div className="grid gap-2" data-testid="ai-score">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => run()} disabled={disabled || pending || ids.length === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Bot />}
          {label}
          {ids.length > 1 ? ` (${ids.length})` : ""}
        </Button>
        <span className="text-[11px] text-muted-foreground">Runs in the background on the scoring model; manual values are never replaced.</span>
      </div>

      {state.kind === "confirm" ? (
        <div role="alert" className="grid gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          <p className="flex items-start gap-2 text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {state.reason === "unpriced"
              ? "The scoring model has no known price, so the cost cannot be estimated."
              : state.reason === "estimate_changed"
                ? "The estimate changed since you confirmed it. Please confirm the new amount."
                : "This batch is above the batch cost limit set in Settings."}
          </p>
          <p className="text-muted-foreground">{describe(state.estimate)}</p>
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="brand" disabled={pending} onClick={() => run(state.estimate.usd ?? 0)}>
              Confirm {state.estimate.usd === null ? "unknown cost" : `up to ${formatUsd(state.estimate.usd)}`} and run
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setState({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {state.kind === "queued" ? (
        <div className="grid gap-1">
          <JobStatus jobId={state.jobId} label="AI scoring" />
          <p className="text-[11px] text-muted-foreground">
            {state.deduplicated ? "Already queued for this selection. " : ""}
            {describe(state.estimate)}
          </p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
