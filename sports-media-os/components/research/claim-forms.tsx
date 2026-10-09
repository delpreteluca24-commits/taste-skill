"use client";

import { Check, Link2, Loader2, Pencil, Plus, Save, Unlink } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FACT_STATUS_ORDER, FACT_STATUS_VIEW, RELATION_VIEW, type ClaimRelation, type FactStatus } from "@/lib/factcheck/presentation";
import {
  createClaimAction,
  deleteClaimAction,
  linkClaimSourceAction,
  setClaimStatusAction,
  setLinkRelationAction,
  unlinkClaimSourceAction,
  updateClaimAction,
} from "@/lib/research/actions";
import { CLAIM_RELATIONS } from "@/lib/research/schema";

import { ConfirmDeleteButton, Field, InlineResult, toFormData, useInlineAction, useResearchForm } from "./form-kit";
import type { SourceOption } from "./item-forms";

function CriticalCheckbox({ id, defaultChecked }: { id: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs">
      <input id={id} type="checkbox" name="isCritical" defaultChecked={defaultChecked} className="mt-0.5 size-3.5 accent-brand" />
      <span>
        Critical claim
        <span className="block text-[11px] text-muted-foreground">
          The story is wrong or misleading if this is false. Critical claims block READY until a person confirms them against a supporting source.
        </span>
      </span>
    </label>
  );
}

/** New claim: starts Uncertain, critical by default. */
export function NewClaimForm({ opportunityId }: { opportunityId: string }) {
  const { state, pending, onSubmit, formRef, errors } = useResearchForm(createClaimAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" data-testid="new-claim-form">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <fieldset disabled={pending} className="grid gap-3">
        <Field id="new-claim" label="Claim" hint="One checkable statement: a result, number, date, quote or event." errors={errors?.claim}>
          <Textarea id="new-claim" name="claim" required rows={2} maxLength={2000} />
        </Field>
        <CriticalCheckbox id="new-claim-critical" defaultChecked />
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add claim
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

/** Edit wording / critical flag (collapsed). Changing the wording resets the status to Uncertain. */
export function EditClaimForm({ factId, claim, isCritical }: { factId: string; claim: string; isCritical: boolean }) {
  const { state, pending, onSubmit, errors } = useResearchForm(updateClaimAction);
  const id = `claim-${factId.slice(0, 8)}`;
  return (
    <details>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground select-none hover:bg-accent hover:text-foreground">
        <Pencil className="size-3" aria-hidden />
        Edit claim
      </summary>
      <form onSubmit={onSubmit} className="mt-2 grid gap-3 rounded-md border border-dashed p-3">
        <input type="hidden" name="factId" value={factId} />
        <fieldset disabled={pending} className="grid gap-3">
          <Field id={id} label="Claim" hint="Changing the wording resets a verified claim to Uncertain." errors={errors?.claim}>
            <Textarea id={id} name="claim" required rows={2} maxLength={2000} defaultValue={claim} />
          </Field>
          <CriticalCheckbox id={`${id}-critical`} defaultChecked={isCritical} />
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="xs" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <ConfirmDeleteButton label="Delete claim" onConfirm={() => deleteClaimAction(null, toFormData({ factId }))} />
          <FormMessage state={state} className="py-1" />
        </div>
      </form>
    </details>
  );
}

/**
 * Link a source to the claim with its relation, excerpt and locator. Linking a
 * source that is already linked updates the link. A new link can be pasted:
 * it is added to the workspace first.
 */
export function LinkSourceForm({
  factId,
  opportunityId,
  sources,
}: {
  factId: string;
  opportunityId: string;
  sources: SourceOption[];
}) {
  const { state, pending, onSubmit, formRef, errors } = useResearchForm(linkClaimSourceAction, { resetOnSuccess: true });
  const id = (k: string) => `link-${factId.slice(0, 8)}-${k}`;
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" data-testid="link-source-form">
      <input type="hidden" name="factId" value={factId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <fieldset disabled={pending} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,10rem)]">
          <Field id={id("source")} label="Source" errors={errors?.sourceId}>
            <NativeSelect id={id("source")} name="sourceId" defaultValue="">
              <option value="">{sources.length ? "Pick a workspace source…" : "No sources yet — paste a link →"}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={id("newUrl")} label="…or paste a new link" errors={errors?.newUrl}>
            <Input id={id("newUrl")} name="newUrl" type="url" maxLength={2048} placeholder="https://…" />
          </Field>
          <Field id={id("relation")} label="Relation" errors={errors?.relation}>
            <NativeSelect id={id("relation")} name="relation" defaultValue="supports">
              {CLAIM_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_VIEW[r].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
          <Field id={id("excerpt")} label="Excerpt" hint="The sentence that supports, contradicts or mentions the claim." errors={errors?.excerpt}>
            <Textarea id={id("excerpt")} name="excerpt" rows={2} maxLength={1000} />
          </Field>
          <Field id={id("locator")} label="Where" hint="Paragraph, page or timestamp." errors={errors?.locator}>
            <Input id={id("locator")} name="locator" maxLength={200} placeholder="e.g. para 3, 01:24" />
          </Field>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="xs" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
          Link source
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

export function UnlinkSourceButton({ factId, sourceId, label }: { factId: string; sourceId: string; label: string }) {
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={pending}
        aria-label={`Unlink ${label}`}
        title="Unlink this source from the claim"
        onClick={() => run(() => unlinkClaimSourceAction(null, toFormData({ factId, sourceId })))}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Unlink />}
        <span className="sr-only sm:not-sr-only">Unlink</span>
      </Button>
      <InlineResult state={state} />
    </span>
  );
}

/** One click to set a link's relation (e.g. the AI's per-source suggestion — a person still decides). */
export function SetRelationButton({
  factId,
  sourceId,
  relation,
  sourceLabel,
}: {
  factId: string;
  sourceId: string;
  relation: ClaimRelation;
  sourceLabel: string;
}) {
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        aria-label={`Set ${sourceLabel} to ${RELATION_VIEW[relation].label}`}
        onClick={() => run(() => setLinkRelationAction(null, toFormData({ factId, sourceId, relation })))}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
        Use “{RELATION_VIEW[relation].label}”
      </Button>
      <InlineResult state={state} />
    </span>
  );
}

/**
 * Human verification: status + confidence + notes. The database stamps who and
 * when, and refuses 'Confirmed' on a critical claim without a supporting source.
 */
export function ClaimStatusForm({
  factId,
  status,
  confidence,
  notes,
  isCritical,
  canConfirm,
}: {
  factId: string;
  status: FactStatus;
  confidence: number | null;
  notes: string | null;
  isCritical: boolean;
  canConfirm: boolean;
}) {
  const { state, pending, onSubmit, errors } = useResearchForm(setClaimStatusAction);
  const id = (k: string) => `status-${factId.slice(0, 8)}-${k}`;
  return (
    <form onSubmit={onSubmit} className="grid gap-3" data-testid="claim-status-form">
      <input type="hidden" name="factId" value={factId} />
      <fieldset disabled={pending} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)_minmax(0,1fr)]">
          <Field id={id("status")} label="Status" errors={errors?.status}>
            <NativeSelect id={id("status")} name="status" defaultValue={status}>
              {FACT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {FACT_STATUS_VIEW[s].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={id("confidence")} label="Confidence (0–1)" errors={errors?.confidence}>
            <Input
              id={id("confidence")}
              name="confidence"
              type="number"
              min={0}
              max={1}
              step={0.05}
              inputMode="decimal"
              defaultValue={confidence ?? ""}
              placeholder="e.g. 0.9"
            />
          </Field>
          <Field id={id("notes")} label="Notes" hint="How it was checked (visible to the team)." errors={errors?.notes}>
            <Textarea id={id("notes")} name="notes" rows={2} maxLength={2000} defaultValue={notes ?? ""} />
          </Field>
        </div>
      </fieldset>
      {isCritical && !canConfirm ? (
        <p className="text-[11px] text-warning">
          Confirming this critical claim needs at least one linked source marked “Supports”.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="xs" variant="brand" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save verification
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
