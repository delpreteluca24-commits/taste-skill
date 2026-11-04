"use client";

import { useId } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, RotateCcw, Save } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { answerQuestionAction, createItemAction, deleteItemAction, updateItemAction } from "@/lib/research/actions";
import { dateInputProps } from "@/lib/research/format";
import { COMPETITOR_PLATFORMS, MEDIA_KINDS } from "@/lib/research/schema";

import { ConfirmDeleteButton, Field, InlineResult, toFormData, useInlineAction, useResearchForm, type FieldErrors } from "./form-kit";

/** Research item types edited with these forms (articles/videos come in through "Add source"). */
export type EditableItemType = "timeline" | "quote" | "media" | "competitor" | "question" | "note" | "context";

export type SourceOption = { id: string; label: string };

/** Serializable values of an existing item (server → client). */
export type ItemFormValue = {
  title: string | null;
  content: string | null;
  url: string | null;
  occurredAt: string | null;
  sourceId: string | null;
  speaker: string | null;
  answered: boolean;
  answer: string | null;
  channel: string | null;
  platform: string | null;
  views: number | null;
  mediaKind: string | null;
};

const EMPTY: ItemFormValue = {
  title: null,
  content: null,
  url: null,
  occurredAt: null,
  sourceId: null,
  speaker: null,
  answered: false,
  answer: null,
  channel: null,
  platform: null,
  views: null,
  mediaKind: null,
};

const MEDIA_KIND_LABELS: Record<(typeof MEDIA_KINDS)[number], string> = {
  video: "Video",
  image: "Image / photo",
  audio: "Audio",
  graphic: "Graphic",
  social_post: "Social post",
};
const PLATFORM_LABELS: Record<(typeof COMPETITOR_PLATFORMS)[number], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  other: "Other",
};

const ADD_LABEL: Record<EditableItemType, string> = {
  timeline: "Add event",
  quote: "Add quote",
  media: "Add media asset",
  competitor: "Log competitor video",
  question: "Add question",
  note: "Add note",
  context: "Add context",
};

function SourceSelect({
  id,
  sources,
  defaultValue,
  emptyLabel = "No source",
}: {
  id: string;
  sources: SourceOption[];
  defaultValue: string | null;
  emptyLabel?: string;
}) {
  return (
    <NativeSelect id={id} name="sourceId" defaultValue={defaultValue ?? ""}>
      <option value="">{emptyLabel}</option>
      {sources.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function ItemFields({
  type,
  value,
  errors,
  sources,
  prefix,
}: {
  type: EditableItemType;
  value: ItemFormValue;
  errors: FieldErrors;
  sources: SourceOption[];
  prefix: string;
}) {
  const id = (k: string) => `${prefix}-${k}`;
  switch (type) {
    case "timeline": {
      const date = dateInputProps(value.occurredAt);
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field id={id("title")} label="What happened" errors={errors?.title}>
              <Input id={id("title")} name="title" required maxLength={500} defaultValue={value.title ?? ""} />
            </Field>
            <Field id={id("occurredAt")} label="Date (UTC)" errors={errors?.occurredAt}>
              <Input id={id("occurredAt")} name="occurredAt" type={date.type} required defaultValue={date.defaultValue} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("sourceId")} label="Source" hint="Which source dates this event." errors={errors?.sourceId}>
              <SourceSelect id={id("sourceId")} sources={sources} defaultValue={value.sourceId} />
            </Field>
            <Field id={id("content")} label="Details" errors={errors?.content}>
              <Textarea id={id("content")} name="content" rows={2} maxLength={2000} defaultValue={value.content ?? ""} />
            </Field>
          </div>
        </>
      );
    }
    case "quote": {
      const date = dateInputProps(value.occurredAt);
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
            <Field id={id("speaker")} label="Speaker" errors={errors?.speaker}>
              <Input id={id("speaker")} name="speaker" required maxLength={200} defaultValue={value.speaker ?? ""} placeholder="Who said it" />
            </Field>
            <Field id={id("saidAt")} label="Said on (UTC)" errors={errors?.saidAt}>
              <Input id={id("saidAt")} name="saidAt" type={date.type} defaultValue={date.defaultValue} />
            </Field>
          </div>
          <Field id={id("content")} label="Exact quote" hint="Word for word, as published." errors={errors?.content}>
            <Textarea id={id("content")} name="content" required rows={3} maxLength={2000} defaultValue={value.content ?? ""} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("sourceId")} label="Attribution: source" errors={errors?.sourceId}>
              <SourceSelect id={id("sourceId")} sources={sources} defaultValue={value.sourceId} emptyLabel="Pick a source, or paste a link →" />
            </Field>
            <Field id={id("url")} label="…or link where it was said" hint="Interview, press conference, post." errors={errors?.url}>
              <Input id={id("url")} name="url" type="url" maxLength={2048} placeholder="https://…" defaultValue={value.url ?? ""} />
            </Field>
          </div>
        </>
      );
    }
    case "media":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field id={id("title")} label="Asset" hint="What it shows." errors={errors?.title}>
              <Input id={id("title")} name="title" required maxLength={500} defaultValue={value.title ?? ""} />
            </Field>
            <Field id={id("mediaKind")} label="Kind" errors={errors?.mediaKind}>
              <NativeSelect id={id("mediaKind")} name="mediaKind" required defaultValue={value.mediaKind ?? ""}>
                <option value="" disabled>
                  Choose…
                </option>
                {MEDIA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MEDIA_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("url")} label="Link to the asset" hint="A new link becomes an unchecked asset in the Rights Center." errors={errors?.url}>
              <Input id={id("url")} name="url" type="url" required maxLength={2048} placeholder="https://…" defaultValue={value.url ?? ""} />
            </Field>
            <Field id={id("sourceId")} label="Existing asset record" hint="Optional: reuse a source already in the workspace." errors={errors?.sourceId}>
              <SourceSelect id={id("sourceId")} sources={sources} defaultValue={value.sourceId} emptyLabel="Create from the link" />
            </Field>
          </div>
          <Field id={id("content")} label="Notes" hint="Owner, where it was found, intended use." errors={errors?.content}>
            <Textarea id={id("content")} name="content" rows={2} maxLength={2000} defaultValue={value.content ?? ""} />
          </Field>
        </>
      );
    case "competitor": {
      const date = dateInputProps(value.occurredAt);
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("title")} label="Their title" errors={errors?.title}>
              <Input id={id("title")} name="title" required maxLength={500} defaultValue={value.title ?? ""} />
            </Field>
            <Field id={id("url")} label="Link" errors={errors?.url}>
              <Input id={id("url")} name="url" type="url" required maxLength={2048} placeholder="https://…" defaultValue={value.url ?? ""} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id={id("channel")} label="Channel / account" errors={errors?.channel}>
              <Input id={id("channel")} name="channel" required maxLength={200} defaultValue={value.channel ?? ""} />
            </Field>
            <Field id={id("platform")} label="Platform" errors={errors?.platform}>
              <NativeSelect id={id("platform")} name="platform" required defaultValue={value.platform ?? ""}>
                <option value="" disabled>
                  Choose…
                </option>
                {COMPETITOR_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={id("views")} label="Views" hint="As shown on the platform; empty if unknown." errors={errors?.views}>
              <Input id={id("views")} name="views" type="number" min={0} step={1} inputMode="numeric" defaultValue={value.views ?? ""} />
            </Field>
            <Field id={id("publishedAt")} label="Published (UTC)" errors={errors?.publishedAt}>
              <Input id={id("publishedAt")} name="publishedAt" type={date.type} defaultValue={date.defaultValue} />
            </Field>
          </div>
          <Field id={id("content")} label="Their angle" hint="What they covered — so our angle can differ." errors={errors?.content}>
            <Textarea id={id("content")} name="content" rows={2} maxLength={1000} defaultValue={value.content ?? ""} />
          </Field>
        </>
      );
    }
    case "question":
      return (
        <>
          <Field id={id("content")} label="Question" errors={errors?.content}>
            <Textarea id={id("content")} name="content" required rows={2} maxLength={1000} defaultValue={value.content ?? ""} />
          </Field>
          {/* keep the answered state when only the wording is edited */}
          <input type="hidden" name="answered" value={value.answered ? "true" : "false"} />
          <input type="hidden" name="answer" value={value.answer ?? ""} />
        </>
      );
    case "note":
      return (
        <>
          <Field id={id("title")} label="Title" errors={errors?.title}>
            <Input id={id("title")} name="title" maxLength={200} defaultValue={value.title ?? ""} />
          </Field>
          <Field id={id("content")} label="Note" errors={errors?.content}>
            <Textarea id={id("content")} name="content" required rows={4} maxLength={8000} defaultValue={value.content ?? ""} />
          </Field>
        </>
      );
    case "context":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("title")} label="Title" errors={errors?.title}>
              <Input id={id("title")} name="title" maxLength={200} defaultValue={value.title ?? ""} />
            </Field>
            <Field id={id("sourceId")} label="Source" errors={errors?.sourceId}>
              <SourceSelect id={id("sourceId")} sources={sources} defaultValue={value.sourceId} />
            </Field>
          </div>
          <Field id={id("content")} label="Background" errors={errors?.content}>
            <Textarea id={id("content")} name="content" required rows={3} maxLength={4000} defaultValue={value.content ?? ""} />
          </Field>
        </>
      );
  }
}

/** Add a research item of one type to the workspace. */
export function NewItemForm({
  opportunityId,
  type,
  sources,
}: {
  opportunityId: string;
  type: EditableItemType;
  sources: SourceOption[];
}) {
  const prefix = `new-${type}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { state, pending, onSubmit, formRef, errors } = useResearchForm(createItemAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" data-testid={`new-${type}-form`}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="type" value={type} />
      <fieldset disabled={pending} className="grid gap-3">
        <ItemFields type={type} value={EMPTY} errors={errors} sources={sources} prefix={prefix} />
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          {ADD_LABEL[type]}
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

/** Edit (collapsed) + delete for an existing item. Its type never changes. */
export function ItemActions({
  itemId,
  type,
  value,
  sources,
  noun,
}: {
  itemId: string;
  type: EditableItemType;
  value: ItemFormValue;
  sources: SourceOption[];
  /** "quote", "event", … for accessible labels */
  noun: string;
}) {
  const prefix = `edit-${itemId.slice(0, 8)}`;
  const { state, pending, onSubmit, errors } = useResearchForm(updateItemAction);
  return (
    <details className="group/edit">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground select-none hover:bg-accent hover:text-foreground">
        <Pencil className="size-3" aria-hidden />
        Edit<span className="sr-only"> {noun}</span>
      </summary>
      <form onSubmit={onSubmit} className="mt-2 grid gap-3 rounded-md border border-dashed p-3">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="type" value={type} />
        <fieldset disabled={pending} className="grid gap-3">
          <ItemFields type={type} value={value} errors={errors} sources={sources} prefix={prefix} />
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="xs" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <ConfirmDeleteButton label={`Delete ${noun}`} onConfirm={() => deleteItemAction(null, toFormData({ itemId }))} />
          <FormMessage state={state} className="py-1" />
        </div>
      </form>
    </details>
  );
}

/** Answer an open question, or reopen an answered one. */
export function AnswerQuestionForm({ itemId, answered, answer }: { itemId: string; answered: boolean; answer: string | null }) {
  const { state, pending, onSubmit, errors } = useResearchForm(answerQuestionAction);
  const reopen = useInlineAction();
  if (answered) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={reopen.pending}
          onClick={() => reopen.run(() => answerQuestionAction(null, toFormData({ itemId, answered: "false", answer: answer ?? "" })))}
        >
          {reopen.pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Reopen
        </Button>
        <InlineResult state={reopen.state && !reopen.state.ok ? reopen.state : null} />
      </span>
    );
  }
  const fieldId = `answer-${itemId.slice(0, 8)}`;
  return (
    <form onSubmit={onSubmit} className="grid gap-2" data-testid="answer-question-form">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="answered" value="true" />
      <Field id={fieldId} label="Answer" hint="Say where the answer comes from (link a source as a claim if it matters)." errors={errors?.answer}>
        <Textarea id={fieldId} name="answer" rows={2} maxLength={4000} required disabled={pending} defaultValue={answer ?? ""} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="xs" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          Mark answered
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
