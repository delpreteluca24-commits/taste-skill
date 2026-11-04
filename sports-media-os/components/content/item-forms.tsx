"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightLeft, BookPlus, CircleCheck, CircleX, Loader2, Plus, Save } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import {
  createContentItem,
  createStoryForItemAction,
  decideStoryAction,
  moveContentItem,
  updateContentItem,
} from "@/lib/content/actions";
import { stageGate } from "@/lib/content/board";
import { CONTENT_FORMATS, FORMAT_HINTS, FORMAT_LABELS, type ContentFormat } from "@/lib/content/schema";
import { CONTENT_STAGE_ORDER, STAGE_LABELS, type ContentStage } from "@/lib/content/stages";

type FieldErrors = Record<string, string[] | undefined> | undefined;
type Fields = { title: string; format: ContentFormat; description: string | null };

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

const errorsOf = <T,>(res: ActionResult<T> | null): FieldErrors => (res && !res.ok ? res.fieldErrors : undefined);

const read = (formData: FormData): Fields => ({
  title: String(formData.get("title") ?? ""),
  format: (CONTENT_FORMATS as readonly string[]).includes(String(formData.get("format"))) ? (formData.get("format") as ContentFormat) : "short",
  description: String(formData.get("description") ?? "") || null,
});

/**
 * React resets uncontrolled forms after an action: on a refusal the typed
 * values come back as the new defaults (the fieldset remounts by `n`).
 */
type FormRun<T> = { res: ActionResult<T>; values: Fields | null; n: number } | null;

function ContentFields({ value, errors, prefix }: { value?: Fields | null; errors: FieldErrors; prefix: string }) {
  const id = (k: string) => `${prefix}-${k}`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field id={id("title")} label="Title" errors={errors?.title}>
          <Input id={id("title")} name="title" required maxLength={300} defaultValue={value?.title ?? ""} />
        </Field>
        <Field id={id("format")} label="Format" errors={errors?.format}>
          <NativeSelect id={id("format")} name="format" defaultValue={value?.format ?? "short"}>
            {CONTENT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]} — {FORMAT_HINTS[f]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id={id("description")} label="Description" hint="What the piece is about and why it matters. Facts go in research, with sources." errors={errors?.description}>
        <Textarea id={id("description")} name="description" rows={3} maxLength={4000} defaultValue={value?.description ?? ""} />
      </Field>
    </>
  );
}

/** "New idea": lands at the top of IDEA. */
export function NewIdeaForm() {
  const [run, action, pending] = useActionState(async (prev: FormRun<{ id: string }>, formData: FormData): Promise<FormRun<{ id: string }>> => {
    const res = await createContentItem(null, formData);
    return { res, values: res.ok ? null : read(formData), n: (prev?.n ?? 0) + 1 };
  }, null);
  const res = run?.res ?? null;
  return (
    <form action={action} className="grid gap-3" data-testid="new-idea-form">
      <fieldset key={run?.n ?? 0} disabled={pending} className="grid gap-3">
        <ContentFields value={run?.values} errors={errorsOf(res)} prefix="idea" />
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add idea
        </Button>
        <FormMessage state={res} className="py-1" />
        {res?.ok ? (
          <Link href={`/content/${res.data.id}`} className="text-xs underline underline-offset-2">
            Open the new item
          </Link>
        ) : null}
      </div>
    </form>
  );
}

export function ContentEditForm({ id, value }: { id: string; value: Fields }) {
  const [run, action, pending] = useActionState(async (prev: FormRun<undefined>, formData: FormData): Promise<FormRun<undefined>> => {
    const res = await updateContentItem(null, formData);
    return { res, values: res.ok ? null : read(formData), n: (prev?.n ?? 0) + 1 };
  }, null);
  const res = run?.res ?? null;
  return (
    <form action={action} className="grid gap-3" data-testid="content-edit-form">
      <input type="hidden" name="id" value={id} />
      <fieldset key={run?.n ?? 0} disabled={pending} className="grid gap-3">
        <ContentFields value={run?.values ?? value} errors={errorsOf(res)} prefix="edit" />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
        <FormMessage state={res} className="py-1" />
      </div>
    </form>
  );
}

/** Stage selector on the item page: the same move as the board (end of the target column). */
export function StageMoveForm({ id, stage }: { id: string; stage: ContentStage }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult<unknown> | null, formData: FormData) => moveContentItem({ id, stage: String(formData.get("stage") ?? "") }),
    null,
  );
  return (
    <form action={action} className="grid gap-2" data-testid="stage-form">
      <Label htmlFor="stage-select">Move to stage</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-60">
          <NativeSelect id="stage-select" name="stage" defaultValue={stage} disabled={pending} key={stage}>
            {CONTENT_STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
                {s === stage ? " (current)" : stageGate(s) ? " — gated" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
          Move
        </Button>
      </div>
      <FormMessage state={state} className="py-1" />
    </form>
  );
}

/** Item without a story: build one from the item (title, description, opportunity angle). */
export function CreateStoryButton({ contentItemId }: { contentItemId: string }) {
  const [state, action, pending] = useActionState(async () => createStoryForItemAction(contentItemId), null);
  return (
    <form action={action} className="grid gap-2" data-testid="create-story">
      <Button type="submit" size="sm" variant="brand" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <BookPlus />}
        Create story
      </Button>
      <FormMessage state={state} className="py-1" />
    </form>
  );
}

export type StoryDecisionDisplay = {
  decision: "approved" | "rejected";
  notes: string | null;
  decidedBy: string | null;
  /** formatted on the server */
  when: string;
};

/**
 * STORY → APPROVAL checkpoint. A person approves or rejects with notes; the
 * decision is recorded by public.record_approval (never by an agent). Footage
 * plays no part in it (STORY ≠ FOOTAGE).
 */
export function StoryDecisionPanel({ storyId, latest }: { storyId: string; latest: StoryDecisionDisplay | null }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) =>
      decideStoryAction(storyId, String(formData.get("decision") ?? ""), String(formData.get("notes") ?? "")),
    null,
  );
  return (
    <div className="grid gap-3" data-testid="story-approval">
      {latest ? (
        <div className="rounded-md border bg-secondary/30 px-3 py-2 text-xs" data-testid="story-latest-decision" data-decision={latest.decision}>
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
        <p className="text-xs text-muted-foreground">No decision yet. A person approves or rejects the story; agents never do.</p>
      )}
      <form action={action} className="grid gap-2">
        <Label htmlFor="story-decision-notes">Notes</Label>
        <Textarea
          id="story-decision-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="Why approve or reject the story (visible to the team)"
          disabled={pending}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="decision" value="approved" size="sm" variant="brand" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CircleCheck />}
            Approve story
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
