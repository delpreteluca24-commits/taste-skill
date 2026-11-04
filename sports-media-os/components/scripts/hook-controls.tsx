"use client";

import { startTransition, useActionState, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Bot, Check, Loader2, Plus, Undo2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/actions";
import { addManualHookAction, generateHooksAction, selectHookAction } from "@/lib/scripts/actions";
import { HOOK_TYPE_LABELS, HOOK_TYPES, HOOKS_PER_RUN } from "@/lib/scripts/schema";

import { describeHooksResult, useQueuedJob } from "./use-queued-job";

/** "Generate 5 hooks" (Hook agent, background job). */
export function GenerateHooksButton({ storyId, activeJobId, factCount }: { storyId: string; activeJobId: string | null; factCount: number }) {
  const { jobId, running, note, error, pending, queue, onDone } = useQueuedJob(activeJobId, describeHooksResult);
  return (
    <div className="grid gap-2" data-testid="generate-hooks">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="brand" disabled={pending || running} onClick={() => queue(() => generateHooksAction(storyId))}>
          {pending ? <Loader2 className="animate-spin" /> : <Bot />}
          Generate {HOOKS_PER_RUN} hooks
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {factCount === 0
            ? "No research facts yet: hooks will stay generic, and names or numbers will be marked as not in the facts."
            : `One call on the Script model, in the background. Built from the ${factCount} research fact${factCount === 1 ? "" : "s"}; existing hooks are not repeated.`}
        </span>
      </div>
      {jobId ? (
        <div className="grid gap-1">
          <JobStatus key={jobId} jobId={jobId} label="Hooks" onDone={onDone} />
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

/** Select this hook (one per story) or clear the selection. */
export function SelectHookButton({ hookId, selected }: { hookId: string; selected: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant={selected ? "outline" : "secondary"}
        disabled={pending}
        aria-pressed={selected}
        onClick={() => start(async () => setState(await selectHookAction(hookId, !selected)))}
      >
        {pending ? <Loader2 className="animate-spin" /> : selected ? <Undo2 /> : <Check />}
        {selected ? "Clear selection" : "Select"}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-[11px] text-danger">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}

/** A person's hook, scored with the transparent heuristic (shown after saving). */
export function ManualHookForm({ storyId }: { storyId: string }) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionResult<{ id: string; score: number }> | null, formData: FormData) => {
      const res = await addManualHookAction(prev, formData);
      if (res.ok) formRef.current?.reset();
      return res;
    },
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" data-testid="manual-hook-form">
      <input type="hidden" name="storyId" value={storyId} />
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${formId}-type`}>Hook type</Label>
          <NativeSelect id={`${formId}-type`} name="hookType" defaultValue="curiosity" className="h-9">
            {HOOK_TYPES.map((t) => (
              <option key={t} value={t}>
                {HOOK_TYPE_LABELS[t].label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors?.hookType} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${formId}-text`}>Hook</Label>
          <Input id={`${formId}-text`} name="text" required maxLength={300} placeholder="One honest sentence, 6–14 words" aria-describedby={`${formId}-hint`} />
          <p id={`${formId}-hint`} className="text-[11px] text-muted-foreground">
            Scored on length, specificity, curiosity and clarity; clickbait phrasing and names or numbers not in the facts lower it.
          </p>
          <FieldError messages={errors?.text} />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add hook
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
