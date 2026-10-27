"use client";

import { useActionState } from "react";
import { CircleCheck, CircleX, Clapperboard, Loader2 } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import { decideOpportunity, startProductionAction } from "@/lib/opportunities/actions";

export type DecisionView = {
  decision: "approved" | "rejected";
  notes: string | null;
  decidedBy: string | null;
  /** formatted on the server */
  when: string;
};

/**
 * OPPORTUNITY → APPROVAL checkpoint. A person approves or rejects with notes;
 * the decision is recorded by public.record_approval (never by an agent).
 */
export function ApprovalPanel({
  id,
  latest,
  locked,
}: {
  id: string;
  latest: DecisionView | null;
  /** production started: decisions are locked */
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) =>
      decideOpportunity(id, String(formData.get("decision") ?? ""), String(formData.get("notes") ?? "")),
    null,
  );

  return (
    <div className="grid gap-3" data-testid="approval-panel">
      {latest ? (
        <div className="rounded-md border bg-secondary/30 px-3 py-2 text-xs" data-testid="latest-decision" data-decision={latest.decision}>
          <p className="flex items-center gap-1.5 font-medium">
            {latest.decision === "approved" ? (
              <CircleCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <CircleX className="size-3.5 text-danger" aria-hidden />
            )}
            {latest.decision === "approved" ? "Approved" : "Rejected"}
            <span className="font-normal text-muted-foreground">
              {latest.decidedBy ? `by ${latest.decidedBy} · ` : ""}
              {latest.when}
            </span>
          </p>
          {latest.notes ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{latest.notes}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No decision yet. A person approves or rejects this opportunity; agents never do.</p>
      )}

      {locked ? (
        <p className="text-[11px] text-muted-foreground">Production has started: the decision is locked.</p>
      ) : (
        <form action={action} className="grid gap-2">
          <Label htmlFor="decision-notes">Notes</Label>
          <Textarea id="decision-notes" name="notes" rows={3} maxLength={2000} placeholder="Why approve or reject (visible to the team)" disabled={pending} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" name="decision" value="approved" size="sm" variant="brand" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
              Approve
            </Button>
            <Button type="submit" name="decision" value="rejected" size="sm" variant="outline" disabled={pending}>
              <CircleX />
              Reject
            </Button>
          </div>
          <FormMessage state={state} className="py-1" />
        </form>
      )}
    </div>
  );
}

/** For an APPROVED opportunity: story + content item, then go to the content workspace. */
export function StartProductionButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(async () => startProductionAction(id), null);
  return (
    <form action={action} className="grid gap-2" data-testid="start-production">
      <Button type="submit" size="sm" variant="brand" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Clapperboard />}
        Start production
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Creates the story and a Short in RESEARCH. Footage is optional: original formats are always possible.
      </p>
      <FormMessage state={state} className="py-1" />
    </form>
  );
}
