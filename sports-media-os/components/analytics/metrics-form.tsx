"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addMetricsAction } from "@/lib/publishing/actions";

const FIELDS = [
  { name: "views", label: "Views", required: true },
  { name: "avg_percentage_viewed", label: "Avg % viewed", step: "0.1" },
  { name: "likes", label: "Likes" },
  { name: "comments", label: "Comments" },
  { name: "shares", label: "Shares" },
  { name: "subscribers_gained", label: "Subs gained" },
] as const;

export function MetricsForm({ contentItemId, platforms }: { contentItemId: string; platforms: string[] }) {
  const [state, action, pending] = useActionState(addMetricsAction, null);
  const options = platforms.length ? platforms : ["youtube", "tiktok", "instagram"];
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Platform
          <NativeSelect name="platform" defaultValue={options[0]}>
            {options.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
        </label>
        {FIELDS.map((f) => (
          <label key={f.name} className="grid gap-1 text-[11px] text-muted-foreground">
            {f.label}
            <Input name={f.name} type="number" min={f.name === "subscribers_gained" ? undefined : 0} step={"step" in f ? f.step : "1"} required={"required" in f} inputMode="decimal" />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending}><Plus /> Save snapshot</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
