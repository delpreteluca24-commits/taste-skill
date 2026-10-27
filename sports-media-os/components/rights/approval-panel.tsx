"use client";

import { useActionState, useState } from "react";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import { decideRightsAction } from "@/lib/rights/actions";

export type RightsDecisionView = {
  decision: "approved" | "rejected";
  notes: string | null;
  decidedBy: string | null;
  /** formatted on the server */
  when: string;
};

/**
 * RIGHTS → APPROVAL for the latest YELLOW classification. A person approves or
 * rejects its use with notes; public.record_approval records it and derives
 * the asset's usability. Approved YELLOW stays off-limits to automated workflows.
 */
export function RightsApprovalPanel({ checkId, latest }: { checkId: string; latest: RightsDecisionView | null }) {
  // controlled: a refused decision (e.g. missing notes) must not wipe what was typed
  const [notes, setNotes] = useState("");
  const [state, action, pending] = useActionState(async (_prev: ActionResult | null, formData: FormData) => {
    const res = await decideRightsAction(checkId, String(formData.get("decision") ?? ""), String(formData.get("notes") ?? ""));
    if (res.ok) setNotes("");
    return res;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-3" data-testid="rights-approval-panel">
      {latest ? (
        <div className="rounded-md border bg-secondary/30 px-3 py-2 text-xs" data-testid="latest-rights-decision" data-decision={latest.decision}>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {latest.decision === "approved" ? (
              <CircleCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <CircleX className="size-3.5 text-danger" aria-hidden />
            )}
            {latest.decision === "approved" ? "Approved for use" : "Rejected"}
            <span className="font-normal text-muted-foreground">
              {latest.decidedBy ? `by ${latest.decidedBy} · ` : ""}
              {latest.when}
            </span>
          </p>
          {latest.notes ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{latest.notes}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No decision yet: the asset is not usable until a person approves it. Agents never approve.</p>
      )}

      <form action={action} className="grid gap-2">
        <Label htmlFor="rights-decision-notes">Notes</Label>
        <Textarea
          id="rights-decision-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          placeholder="Who confirmed the rights, the scope, and where the proof is kept"
          disabled={pending}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-invalid={errors?.notes ? true : undefined}
        />
        <FieldError messages={errors?.notes} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="decision" value="approved" size="sm" variant="brand" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
            Approve use
          </Button>
          <Button type="submit" name="decision" value="rejected" size="sm" variant="outline" disabled={pending}>
            <CircleX />
            Reject
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Approval applies to this classification only. Recording a new one needs a new decision.
        </p>
        <FormMessage state={state} className="py-1" />
      </form>
    </div>
  );
}
