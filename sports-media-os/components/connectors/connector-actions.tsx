"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Download, Loader2, Pencil, Power, PowerOff, Trash2 } from "lucide-react";

import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { deleteConnectorAction, fetchConnectorNowAction, setConnectorEnabledAction } from "@/lib/connectors/actions";

/**
 * Row actions: Fetch now (queues a worker job, progress via <JobStatus>),
 * edit, enable/disable, delete with an inline confirmation.
 */
export function ConnectorActions({
  connectorId,
  name,
  enabled,
  activeJobId,
}: {
  connectorId: string;
  name: string;
  enabled: boolean;
  /** a fetch already queued/running when the page loaded */
  activeJobId?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(activeJobId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"fetch" | "toggle" | "delete" | null>(null);

  function run(kind: "fetch" | "toggle" | "delete", fn: () => Promise<string | null>) {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      const failure = await fn();
      setError(failure);
      setBusy(null);
    });
  }

  const fetchNow = () =>
    run("fetch", async () => {
      const result = await fetchConnectorNowAction(connectorId);
      if (!result.ok) return result.error;
      setJobId(result.data.jobId);
      return null;
    });

  const toggle = () =>
    run("toggle", async () => {
      const result = await setConnectorEnabledAction(connectorId, !enabled);
      return result.ok ? null : result.error;
    });

  const remove = () =>
    run("delete", async () => {
      const result = await deleteConnectorAction(connectorId);
      if (result.ok) setConfirming(false);
      return result.ok ? null : result.error;
    });

  const spinner = (kind: typeof busy) => (busy === kind ? <Loader2 className="animate-spin" aria-hidden /> : null);

  return (
    <div className="grid justify-items-end gap-1.5" data-testid="connector-actions">
      <div className="flex flex-wrap justify-end gap-1">
        <Button type="button" size="xs" variant="secondary" onClick={fetchNow} disabled={pending} aria-label={`Fetch ${name} now`}>
          {spinner("fetch") ?? <Download aria-hidden />}
          Fetch now
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link href={`/radar/connectors?edit=${connectorId}`} aria-label={`Edit ${name}`}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={toggle} disabled={pending} aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}>
          {spinner("toggle") ?? (enabled ? <PowerOff aria-hidden /> : <Power aria-hidden />)}
          {enabled ? "Disable" : "Enable"}
        </Button>
        {!confirming ? (
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(true)} disabled={pending} aria-label={`Delete ${name}`}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <div role="alertdialog" aria-label={`Confirm deleting ${name}`} className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-xs">
          <span className="text-danger">Delete “{name}”? Sources it already collected are kept.</span>
          <Button type="button" size="xs" variant="destructive" onClick={remove} disabled={pending}>
            {spinner("delete")}
            Delete connector
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : null}

      {jobId ? <JobStatus key={jobId} jobId={jobId} label="Fetch" /> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
