"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import { createEventAction, deleteEventAction, updateEventAction } from "@/lib/radar/actions";
import { EVENT_STATUS_LABELS, EVENT_STATUSES, type EventStatus } from "@/lib/radar/schema";

/** Form values as strings; times are "YYYY-MM-DDTHH:mm" in the project timezone. */
export type EventFormValue = {
  id?: string;
  title: string;
  sportId: string | null;
  competition: string | null;
  venue: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  importance: number | null;
};

export const EMPTY_EVENT: EventFormValue = {
  title: "",
  sportId: null,
  competition: null,
  venue: null,
  description: null,
  startsAt: "",
  endsAt: "",
  status: "scheduled",
  importance: null,
};

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

/**
 * Manual event entry/edit (fixtures no connector provides). Events feed the
 * "Upcoming" / "Just finished" sections and give trends their
 * upcoming_event / just_finished signals.
 */
export function EventForm({ value, sports, tz }: { value: EventFormValue; sports: { id: string; name: string }[]; tz: string }) {
  const editing = Boolean(value.id);
  const [state, action, pending] = useActionState<ActionResult<{ eventId: string }> | null, FormData>(
    editing ? updateEventAction : createEventAction,
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const id = (k: string) => `ev-${value.id ? "edit" : "new"}-${k}`;

  return (
    <form action={action} className="grid gap-3" data-testid="event-form">
      {value.id ? <input type="hidden" name="id" value={value.id} /> : null}
      <fieldset disabled={pending} className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field id={id("title")} label="Title" hint="e.g. Inter vs Bologna, Shanghai Masters final" errors={errors?.title}>
            <Input id={id("title")} name="title" required maxLength={300} defaultValue={value.title} />
          </Field>
          <Field id={id("sport")} label="Sport" errors={errors?.sportId}>
            <NativeSelect id={id("sport")} name="sportId" defaultValue={value.sportId ?? ""}>
              <option value="">Not set</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={id("status")} label="Status" errors={errors?.status}>
            <NativeSelect id={id("status")} name="status" defaultValue={value.status}>
              {EVENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EVENT_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field id={id("competition")} label="Competition" hint="League or tournament" errors={errors?.competition}>
            <Input id={id("competition")} name="competition" maxLength={120} defaultValue={value.competition ?? ""} />
          </Field>
          <Field id={id("venue")} label="Venue" errors={errors?.venue}>
            <Input id={id("venue")} name="venue" maxLength={200} defaultValue={value.venue ?? ""} />
          </Field>
          <Field id={id("starts")} label="Starts" hint={`Project time (${tz})`} errors={errors?.startsAt}>
            <Input id={id("starts")} name="startsAt" type="datetime-local" defaultValue={value.startsAt} />
          </Field>
          <Field id={id("ends")} label="Ends" hint="Optional" errors={errors?.endsAt}>
            <Input id={id("ends")} name="endsAt" type="datetime-local" defaultValue={value.endsAt} />
          </Field>
          <Field id={id("importance")} label="Importance" hint="0–100, optional" errors={errors?.importance}>
            <Input id={id("importance")} name="importance" type="number" min={0} max={100} step={1} defaultValue={value.importance ?? ""} />
          </Field>
        </div>
        <Field id={id("description")} label="Notes" hint="Context for the editors (not published)." errors={errors?.description}>
          <Textarea id={id("description")} name="description" rows={2} maxLength={2000} defaultValue={value.description ?? ""} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant={editing ? "secondary" : "brand"} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : editing ? <Save aria-hidden /> : <Plus aria-hidden />}
          {editing ? "Save event" : "Add event"}
        </Button>
        {editing ? (
          <Button asChild size="sm" variant="ghost">
            <Link href="/radar">Cancel</Link>
          </Button>
        ) : null}
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

/** Admin-only delete with an inline confirmation; linked trends and sources keep existing. */
export function DeleteEventButton({ eventId, title }: { eventId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await deleteEventAction(eventId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/radar");
    });

  return (
    <div className="grid justify-items-start gap-1.5">
      {confirming ? (
        <div role="alertdialog" aria-label={`Confirm deleting ${title}`} className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-xs">
          <span className="text-danger">Delete “{title}”? Trends and sources linked to it are kept.</span>
          <Button type="button" size="xs" variant="destructive" onClick={remove} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Delete event
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Delete ${title}`}>
          <Trash2 aria-hidden />
          Delete
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
