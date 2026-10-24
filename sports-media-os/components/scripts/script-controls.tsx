"use client";

import { startTransition, useActionState, useId, useState, useTransition, type FormEvent } from "react";
import { CircleCheck, CircleX, Loader2, Maximize2, Palette, Pin, RefreshCw, Save, Scissors, Sparkles, Type } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { JobStatus } from "@/components/jobs/job-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import {
  createManualVersionAction,
  decideScriptAction,
  generateScriptsAction,
  setCurrentScriptAction,
  transformScriptAction,
  type QueuedJob,
} from "@/lib/scripts/actions";
import {
  ANGLE_LABELS,
  DEFAULT_ANGLES,
  SCRIPT_ANGLES,
  SCRIPT_SECTIONS,
  TRANSFORM_LABELS,
  type ScriptAngle,
  type ScriptSections,
  type ScriptTransform,
} from "@/lib/scripts/schema";

import { describeGenerateResult, describeTransformResult, useQueuedJob } from "./use-queued-job";

/* ------------------------------------------------------------------------- */
/* generate angles                                                           */
/* ------------------------------------------------------------------------- */

/** Pick 1–5 angles (three pre-selected) → one background job, one new version per angle. */
export function GenerateAnglesForm({
  storyId,
  activeJobId,
  hasVersions,
}: {
  storyId: string;
  /** a script.generate job still pending/running for this story */
  activeJobId: string | null;
  hasVersions: boolean;
}) {
  const formId = useId();
  const [picked, setPicked] = useState<ScriptAngle[]>([...DEFAULT_ANGLES]);
  const [state, formAction, pending] = useActionState<ActionResult<QueuedJob> | null, FormData>(generateScriptsAction, null);
  // the job to follow: the one just queued, else the one already open for this story
  const jobId = state?.ok ? state.data.jobId : activeJobId;
  const [done, setDone] = useState<{ jobId: string; outcome: string | null } | null>(null);
  const running = jobId !== null && done?.jobId !== jobId;
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3" data-testid="generate-angles">
      <input type="hidden" name="storyId" value={storyId} />
      <fieldset disabled={pending || running} className="grid gap-2">
        <legend className="mb-1 text-xs font-medium">Angles to write</legend>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {SCRIPT_ANGLES.map((angle) => {
            const id = `${formId}-${angle}`;
            const checked = picked.includes(angle);
            return (
              <label
                key={angle}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs has-[:checked]:border-brand/50 has-[:checked]:bg-brand/5"
              >
                <input
                  id={id}
                  type="checkbox"
                  name="angle"
                  value={angle}
                  checked={checked}
                  onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, angle] : prev.filter((a) => a !== angle)))}
                  className="mt-0.5 size-3.5 accent-brand"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{ANGLE_LABELS[angle].label}</span>
                  <span className="text-muted-foreground">{ANGLE_LABELS[angle].description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <FieldError messages={errors?.angles} />
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="brand" disabled={pending || running || picked.length === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {hasVersions ? "Generate more" : "Generate"} {picked.length} angle{picked.length === 1 ? "" : "s"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          One model call per angle on the Script model, in the background. Each angle becomes a new version; nothing is approved automatically.
        </span>
      </div>
      {jobId ? (
        <div className="grid gap-1">
          <JobStatus
            key={jobId}
            jobId={jobId}
            label="Scripts"
            onDone={(job) => setDone({ jobId: job.id, outcome: job.status === "completed" ? describeGenerateResult(job.result) : null })}
          />
          {done?.jobId === jobId && done.outcome ? <p className="text-[11px] text-muted-foreground">{done.outcome}</p> : null}
        </div>
      ) : null}
      <FormMessage state={state} className="py-1" />
    </form>
  );
}

/* ------------------------------------------------------------------------- */
/* transforms                                                                */
/* ------------------------------------------------------------------------- */

const TRANSFORM_ICON: Record<Exclude<ScriptTransform, "change_tone">, typeof RefreshCw> = {
  regenerate: RefreshCw,
  shorten: Scissors,
  expand: Maximize2,
  rewrite_hook: Type,
};

/** Regenerate / Shorten / Expand / Rewrite hook / Change tone → a NEW version (background job). */
export function TransformControls({
  scriptId,
  version,
  activeJobId,
}: {
  scriptId: string;
  version: number;
  /** a script.transform job still pending/running from this version */
  activeJobId: string | null;
}) {
  const { jobId, running, note, error, pending, queue, onDone } = useQueuedJob(activeJobId, describeTransformResult);
  const [tone, setTone] = useState("");
  const toneId = useId();
  const busy = pending || running;

  return (
    <div className="grid gap-2" data-testid="transform-controls">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Rewrite version ${version} as a new version`}>
        {(Object.keys(TRANSFORM_ICON) as (keyof typeof TRANSFORM_ICON)[]).map((op) => {
          const Icon = TRANSFORM_ICON[op];
          return (
            <Button
              key={op}
              type="button"
              size="xs"
              variant="secondary"
              disabled={busy}
              title={TRANSFORM_LABELS[op].description}
              onClick={() => queue(() => transformScriptAction({ scriptId, operation: op }))}
            >
              <Icon />
              {TRANSFORM_LABELS[op].label}
            </Button>
          );
        })}
      </div>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          queue(() => transformScriptAction({ scriptId, operation: "change_tone", tone }));
        }}
      >
        <Label htmlFor={toneId} className="sr-only">
          New tone for version {version}
        </Label>
        <Input
          id={toneId}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          maxLength={60}
          placeholder="Tone, e.g. calm and analytical"
          className="h-7 w-56 max-w-full text-xs"
          disabled={busy}
        />
        <Button type="submit" size="xs" variant="secondary" disabled={busy || tone.trim().length < 2} title={TRANSFORM_LABELS.change_tone.description}>
          <Palette />
          Change tone
        </Button>
      </form>
      {jobId ? (
        <div className="grid gap-1">
          <JobStatus key={jobId} jobId={jobId} label="Rewrite" onDone={onDone} />
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

/* ------------------------------------------------------------------------- */
/* make current                                                              */
/* ------------------------------------------------------------------------- */

export function MakeCurrentButton({ scriptId, version }: { scriptId: string; version: number }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        title="Production uses the current version, after its approval"
        onClick={() => start(async () => setState(await setCurrentScriptAction(scriptId)))}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Pin />}
        Make v{version} current
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-[11px] text-danger">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* approval                                                                  */
/* ------------------------------------------------------------------------- */

export type ScriptDecisionDisplay = {
  decision: "approved" | "rejected";
  notes: string | null;
  decidedBy: string | null;
  /** formatted on the server */
  when: string;
};

/** SCRIPT → APPROVAL for the current version. A person decides; agents never approve. */
export function ScriptDecisionForm({
  scriptId,
  version,
  latest,
  warningCount,
}: {
  scriptId: string;
  version: number;
  latest: ScriptDecisionDisplay | null;
  /** grounding warnings on this version: approving means a person checked them */
  warningCount: number;
}) {
  const notesId = useId();
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) =>
      decideScriptAction(scriptId, String(formData.get("decision") ?? ""), String(formData.get("notes") ?? "")),
    null,
  );

  return (
    <div className="grid gap-3" data-testid="script-approval">
      {latest ? (
        <div className="rounded-md border bg-secondary/30 px-3 py-2 text-xs" data-testid="script-latest-decision" data-decision={latest.decision}>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
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
        <p className="text-xs text-muted-foreground">
          Version {version} has no decision yet. Content cannot move to production until a person approves the current script.
        </p>
      )}
      {warningCount > 0 ? (
        <p className="text-[11px] text-warning" role="note">
          This version has {warningCount} grounding warning{warningCount === 1 ? "" : "s"}. Approve only after checking {warningCount === 1 ? "it" : "them"} against
          the research.
        </p>
      ) : null}
      <form action={action} className="grid gap-2">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea
          id={notesId}
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="What was checked, or what must change (visible to the team)"
          disabled={pending}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="decision" value="approved" size="sm" variant="brand" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
            Approve v{version}
          </Button>
          <Button type="submit" name="decision" value="rejected" size="sm" variant="outline" disabled={pending}>
            <CircleX />
            Reject
          </Button>
        </div>
        <FormMessage state={state} className="py-1" />
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* manual editor                                                             */
/* ------------------------------------------------------------------------- */

const SECTION_LIMIT: Record<keyof ScriptSections, number> = {
  hook: 300,
  context: 1500,
  escalation: 1500,
  reveal: 1500,
  payoff: 1500,
  cta: 300,
};

/**
 * Edit → saves a NEW version (operation "manual", parent = current) that
 * becomes current. Versions are never edited in place.
 */
export function ManualVersionEditor({
  storyId,
  initial,
  tone,
  baseVersion,
}: {
  storyId: string;
  /** current version's sections (empty for the first version) */
  initial: ScriptSections | null;
  tone: string | null;
  /** current version number, or null when the story has none (then an angle can be picked) */
  baseVersion: number | null;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(createManualVersionAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // keep what was typed on a validation error (no automatic form reset)
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3" data-testid="manual-version-editor">
      <input type="hidden" name="storyId" value={storyId} />
      <p className="text-[11px] text-muted-foreground">
        {baseVersion
          ? `Starts from version ${baseVersion}. Saving creates a new version that becomes current and needs approval; version ${baseVersion} stays unchanged.`
          : "Saving creates version 1 and makes it current. It needs approval before production."}{" "}
        Numbers and quotes are checked against the research.
      </p>
      <fieldset disabled={pending} className="grid gap-3">
        {baseVersion === null ? (
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor={`${formId}-angle`}>Angle</Label>
            <NativeSelect id={`${formId}-angle`} name="angle" defaultValue="" className="h-8 text-xs">
              <option value="">No angle</option>
              {SCRIPT_ANGLES.map((a) => (
                <option key={a} value={a}>
                  {ANGLE_LABELS[a].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {SCRIPT_SECTIONS.map((s) => {
          const id = `${formId}-${s.key}`;
          const short = s.key === "hook" || s.key === "cta";
          return (
            <div key={s.key} className="grid gap-1.5">
              <Label htmlFor={id}>{s.label}</Label>
              <Textarea
                id={id}
                name={s.key}
                rows={short ? 2 : 3}
                required
                maxLength={SECTION_LIMIT[s.key]}
                defaultValue={initial?.[s.key] ?? ""}
                aria-describedby={`${id}-hint`}
              />
              <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
                {s.hint}
              </p>
              <FieldError messages={errors?.[s.key]} />
            </div>
          );
        })}
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor={`${formId}-tone`}>Tone (optional)</Label>
          <Input id={`${formId}-tone`} name="tone" maxLength={60} defaultValue={tone ?? ""} placeholder="e.g. calm and analytical" />
          <FieldError messages={errors?.tone} />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save as new version
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
