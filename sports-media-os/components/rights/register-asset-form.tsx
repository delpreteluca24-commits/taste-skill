"use client";

import { useActionState } from "react";
import { Loader2, Plus } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { registerAssetAction } from "@/lib/rights/actions";
import { ASSET_KINDS } from "@/lib/rights/schema";

/**
 * Register an external asset (video link, social post, image, official
 * material). The same link is reused, never duplicated; the asset opens for
 * classification right after.
 */
export function RegisterAssetForm() {
  const [state, action, pending] = useActionState(registerAssetAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-3" data-testid="register-asset-form">
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor="asset-url">Link</Label>
          <Input id="asset-url" name="url" type="url" required maxLength={2048} placeholder="https://…" aria-invalid={errors?.url ? true : undefined} />
          <p className="text-[11px] text-muted-foreground">The page or post where the asset lives. Registering a link never downloads it.</p>
          <FieldError messages={errors?.url} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="asset-kind">Kind</Label>
          <NativeSelect id="asset-kind" name="kind" defaultValue="video" aria-invalid={errors?.kind ? true : undefined}>
            {ASSET_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors?.kind} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="asset-title">Title</Label>
          <Input id="asset-title" name="title" maxLength={300} placeholder="What it shows (optional)" />
          <FieldError messages={errors?.title} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="asset-publisher">Publisher</Label>
          <Input id="asset-publisher" name="publisher" maxLength={200} placeholder="Defaults to the link's site" />
          <FieldError messages={errors?.publisher} />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Register and classify
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
