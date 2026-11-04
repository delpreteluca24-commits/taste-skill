"use client";

import { startTransition, useActionState, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { FieldError } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions";

/**
 * Small form toolkit for the Research Workspace (client only).
 * Forms submit from onSubmit (not <form action>) so a validation error keeps
 * what the user typed; "new" forms are cleared only after a successful save.
 */

export type FieldErrors = Record<string, string[] | undefined> | undefined;
type FormAction<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

export function useResearchForm<T>(action: FormAction<T>, opts: { resetOnSuccess?: boolean } = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<T> | null, formData: FormData) => {
    const res = await action(prev, formData);
    if (res.ok && opts.resetOnSuccess) formRef.current?.reset();
    return res;
  }, null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return { state, pending, onSubmit, formRef, errors: (state && !state.ok ? state.fieldErrors : undefined) as FieldErrors };
}

/** One-click server action (no form fields): builds the FormData itself. */
export function useInlineAction() {
  const [pending, start] = useTransition();
  const [state, run] = useActionState(
    async (_prev: ActionResult<unknown> | null, fn: () => Promise<ActionResult<unknown>>) => fn(),
    null,
  );
  return { pending, state, run: (fn: () => Promise<ActionResult<unknown>>) => start(() => run(fn)) };
}

export function toFormData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

export function Field({
  id,
  label,
  hint,
  errors,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `grid content-start gap-1.5 ${className}` : "grid content-start gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <FieldError messages={errors} />
    </div>
  );
}

/** Inline result of a one-click action: errors always, successes only when they say something. */
export function InlineResult({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <span role="alert" className="text-[11px] text-danger">
        {state.error}
      </span>
    );
  }
  return state.message ? (
    <span role="status" className="text-[11px] text-success">
      {state.message}
    </span>
  ) : null;
}

/**
 * Two-step delete (click → confirm). Deleting research is an admin action in
 * the database; a refused delete shows the permission message.
 */
export function ConfirmDeleteButton({
  label,
  text = "Delete",
  confirmLabel = "Confirm delete",
  onConfirm,
}: {
  /** accessible name, e.g. "Delete quote" */
  label: string;
  /** visible text of the first button */
  text?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<ActionResult<unknown>>;
}) {
  const [armed, setArmed] = useState(false);
  const { pending, state, run } = useInlineAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {armed ? (
        <>
          <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={() => run(onConfirm)}>
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {confirmLabel}
          </Button>
          <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" size="xs" variant="ghost" aria-label={label} title={label} onClick={() => setArmed(true)}>
          <Trash2 />
          <span className="sr-only sm:not-sr-only">{text}</span>
        </Button>
      )}
      <InlineResult state={state && !state.ok ? state : null} />
    </span>
  );
}
