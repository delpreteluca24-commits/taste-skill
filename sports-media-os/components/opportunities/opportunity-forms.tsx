"use client";

import { useActionState, useTransition, type ReactNode } from "react";
import { Loader2, Plus, RotateCcw, Save } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import {
  createManualOpportunity,
  rescore,
  resetComponentScore,
  setComponentScore,
  updateOpportunity,
} from "@/lib/opportunities/actions";

type FieldErrors = Record<string, string[] | undefined> | undefined;

function Field({ id, label, hint, errors, children }: { id: string; label: string; hint?: string; errors?: string[]; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <FieldError messages={errors} />
    </div>
  );
}

function errorsOf<T>(state: ActionResult<T> | null): FieldErrors {
  return state && !state.ok ? state.fieldErrors : undefined;
}

type Editable = {
  title: string;
  description: string | null;
  why_now: string | null;
  angle: string | null;
  hook: string | null;
  competition: string | null;
};

function EditorialFields({ value, errors, prefix }: { value?: Partial<Editable>; errors: FieldErrors; prefix: string }) {
  const id = (k: string) => `${prefix}-${k}`;
  return (
    <>
      <Field id={id("title")} label="Title" errors={errors?.title}>
        <Input id={id("title")} name="title" required maxLength={300} defaultValue={value?.title ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id("why_now")} label="Why now" hint="What makes this worth publishing today." errors={errors?.why_now}>
          <Textarea id={id("why_now")} name="why_now" rows={3} maxLength={1000} defaultValue={value?.why_now ?? ""} />
        </Field>
        <Field id={id("angle")} label="Angle" hint="Our take — originality is judged against the trend headline." errors={errors?.angle}>
          <Textarea id={id("angle")} name="angle" rows={3} maxLength={1000} defaultValue={value?.angle ?? ""} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id("hook")} label="Hook" errors={errors?.hook}>
          <Input id={id("hook")} name="hook" maxLength={500} defaultValue={value?.hook ?? ""} />
        </Field>
        <Field id={id("competition")} label="Competition" hint="e.g. Serie A, Wimbledon" errors={errors?.competition}>
          <Input id={id("competition")} name="competition" maxLength={120} defaultValue={value?.competition ?? ""} />
        </Field>
      </div>
      <Field id={id("description")} label="Description" errors={errors?.description}>
        <Textarea id={id("description")} name="description" rows={4} maxLength={4000} defaultValue={value?.description ?? ""} />
      </Field>
    </>
  );
}

/** Manual opportunity (no trend). Redirects to the new opportunity on success. */
export function NewOpportunityForm({ sports }: { sports: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createManualOpportunity, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="grid gap-3" data-testid="new-opportunity-form">
      <fieldset disabled={pending} className="grid gap-3">
        <EditorialFields errors={errors} prefix="new" />
        <Field id="new-sport" label="Sport" hint="Sets the audience and monetization baselines." errors={errors?.sportId}>
          <NativeSelect id="new-sport" name="sportId" defaultValue="">
            <option value="">Unknown / not sport-specific</option>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Create and score
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

export function OpportunityEditForm({ id, value, disabled }: { id: string; value: Editable; disabled?: boolean }) {
  const [state, action, pending] = useActionState(updateOpportunity, null);
  return (
    <form action={action} className="grid gap-3" data-testid="opportunity-edit-form">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={disabled || pending} className="grid gap-3">
        <EditorialFields value={value} errors={errorsOf(state)} prefix="edit" />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

/** Manual override of one score component, with a mandatory reason. */
export function ComponentOverrideForm({
  id,
  components,
  disabled,
}: {
  id: string;
  components: { key: string; label: string; weight: number }[];
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(setComponentScore, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="grid gap-3 rounded-md border border-dashed p-3" data-testid="component-override-form">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs font-medium">Manual override</p>
      <fieldset disabled={disabled || pending} className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_6rem_minmax(0,1fr)]">
        <Field id="override-component" label="Component" errors={errors?.component}>
          <NativeSelect id="override-component" name="component" defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {components.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.weight})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="override-value" label="Value (0–100)" errors={errors?.value}>
          <Input id="override-value" name="value" type="number" min={0} max={100} step={1} required />
        </Field>
        <Field id="override-reason" label="Reason" errors={errors?.reason}>
          <Input id="override-reason" name="reason" required minLength={3} maxLength={500} placeholder="Why this value? Shown next to the number." />
        </Field>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save override
        </Button>
        <FormMessage state={state} className="py-1" />
        <p className="text-[11px] text-muted-foreground">Manual values are never replaced by heuristics or AI.</p>
      </div>
    </form>
  );
}

function useInlineAction() {
  const [pending, startTransition] = useTransition();
  const [state, run] = useActionState(async (_prev: ActionResult<unknown> | null, fn: () => Promise<ActionResult<unknown>>) => fn(), null);
  return { pending, state, run: (fn: () => Promise<ActionResult<unknown>>) => startTransition(() => run(fn)) };
}

/** Back to the heuristic estimate for one component. */
export function ResetComponentButton({ id, component, label }: { id: string; component: string; label: string }) {
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => resetComponentScore(id, component))}
        aria-label={`Reset ${label} to the heuristic estimate`}
        title="Back to the heuristic estimate"
      >
        {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Reset
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-[11px] text-danger">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}

/** Recompute heuristic components from current research, rights and timing. */
export function RescoreButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled || pending} onClick={() => run(() => rescore(id))}>
        {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Recompute heuristics
      </Button>
      <FormMessage state={state} className="py-1" />
    </span>
  );
}
