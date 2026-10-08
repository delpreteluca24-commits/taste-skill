"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction } from "@/lib/projects/actions";

const LANGUAGES = [
  ["en", "English"],
  ["it", "Italiano"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["pt", "Português"],
] as const;

type Props = {
  sports: { id: string; name: string }[];
  timezones: string[];
};

export function CreateProjectForm({ sports, timezones }: Props) {
  const [state, formAction, pending] = useActionState(createProjectAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Project / channel name</Label>
        <Input id="name" name="name" placeholder="Football Shorts" required maxLength={80} aria-invalid={Boolean(errors?.name)} />
        <FieldError messages={errors?.name} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" maxLength={500} rows={2} placeholder="Positioning, audience, format" />
        <FieldError messages={errors?.description} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="primarySportId">Primary sport</Label>
          <NativeSelect id="primarySportId" name="primarySportId" defaultValue="">
            <option value="">Multi-sport</option>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors?.primarySportId} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="language">Language</Label>
          <NativeSelect id="language" name="language" defaultValue="en">
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors?.language} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <NativeSelect id="timezone" name="timezone" defaultValue="UTC">
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors?.timezone} />
        </div>
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Create project
        </Button>
      </div>
    </form>
  );
}
