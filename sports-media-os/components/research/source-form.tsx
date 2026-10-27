"use client";

import { Loader2, Plus } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addSourceAction, deleteItemAction } from "@/lib/research/actions";
import { SOURCE_TYPE_LABELS, SOURCE_TYPES } from "@/lib/research/schema";

import { ConfirmDeleteButton, Field, toFormData, useResearchForm } from "./form-kit";

/**
 * Add a source by link. The same canonical link reuses the project's existing
 * source (and its rights classification); a new source starts 'unchecked'.
 */
export function AddSourceForm({ opportunityId }: { opportunityId: string }) {
  const { state, pending, onSubmit, formRef, errors } = useResearchForm(addSourceAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" data-testid="add-source-form">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <fieldset disabled={pending} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field id="src-url" label="Link" hint="Article, official page, press release or video page." errors={errors?.url}>
            <Input id="src-url" name="url" type="url" required maxLength={2048} placeholder="https://…" inputMode="url" />
          </Field>
          <Field id="src-type" label="Type" errors={errors?.type}>
            <NativeSelect id="src-type" name="type" defaultValue="news">
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="src-title" label="Title" hint="Optional: the headline as published." errors={errors?.title}>
            <Input id="src-title" name="title" maxLength={500} />
          </Field>
          <Field id="src-publisher" label="Publisher" hint="Optional: defaults to the link's site." errors={errors?.publisher}>
            <Input id="src-publisher" name="publisher" maxLength={200} />
          </Field>
        </div>
        <Field
          id="src-summary"
          label="Summary"
          hint="What the source says, in your words. The AI research assist reads titles and summaries only."
          errors={errors?.summary}
        >
          <Textarea id="src-summary" name="summary" rows={2} maxLength={2000} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add source
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

/** Remove the source's research item from this workspace (the project source and its rights record stay). */
export function RemoveSourceItemButton({ itemId, title }: { itemId: string; title: string }) {
  return (
    <ConfirmDeleteButton
      label={`Remove ${title} from this workspace`}
      text="Remove"
      confirmLabel="Confirm remove"
      onConfirm={() => deleteItemAction(null, toFormData({ itemId }))}
    />
  );
}
