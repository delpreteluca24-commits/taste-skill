"use client";

import { useActionState, useState } from "react";
import { Loader2, Save, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { FormMessage } from "@/components/common/form-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions";
import type { EditorialFormat } from "@/lib/rights/alternatives";
import { saveProductionFormats } from "@/lib/rights/actions";
import type { FormatOption } from "@/lib/rights/schema";
import { cn } from "@/lib/utils";

const RISK_META = {
  none: { label: "No third-party rights", icon: ShieldCheck, variant: "success" },
  documented: { label: "Needs cleared assets", icon: ShieldAlert, variant: "warning" },
  check: { label: "Classify each source", icon: ShieldAlert, variant: "warning" },
} as const;

/**
 * STORY ≠ FOOTAGE: ranked editorial formats with a checkbox each; saving
 * stores the chosen plan on the story (stories.production_formats). Choosing a
 * footage format clears no asset: each one still needs GREEN or an approved YELLOW.
 */
export function ProductionFormatsForm({ storyId, options, selected }: { storyId: string; options: FormatOption[]; selected: EditorialFormat[] }) {
  // controlled: a refused save must not lose the selection
  const [chosen, setChosen] = useState<ReadonlySet<EditorialFormat>>(() => new Set(selected));
  const [state, action, pending] = useActionState(async (_prev: ActionResult<{ formats: EditorialFormat[] }> | null, formData: FormData) => {
    const res = await saveProductionFormats(storyId, formData.getAll("formats").map(String));
    if (res.ok) setChosen(new Set(res.data.formats));
    return res;
  }, null);

  const toggle = (format: EditorialFormat, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(format);
      else next.delete(format);
      return next;
    });

  const footageChosen = options.some((o) => o.risk !== "none" && chosen.has(o.format));

  return (
    <form action={action} className="grid gap-3" data-testid="production-formats-form">
      <fieldset disabled={pending} className="grid gap-2">
        <legend className="mb-1.5 text-xs font-medium">Suggested formats, best fit first</legend>
        <ul className="grid gap-1.5">
          {options.map((o, i) => {
            const risk = RISK_META[o.risk];
            const RiskIcon = risk.icon;
            const id = `pf-${storyId}-${o.format}`;
            const checked = chosen.has(o.format);
            return (
              <li
                key={o.format}
                className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-md border px-3 py-2", checked && "border-brand/50 bg-brand/5")}
                data-testid="format-suggestion"
                data-format={o.format}
              >
                <input
                  id={id}
                  type="checkbox"
                  name="formats"
                  value={o.format}
                  checked={checked}
                  onChange={(e) => toggle(o.format, e.target.checked)}
                  className="mt-0.5 size-3.5 accent-brand"
                  aria-describedby={`${id}-reason`}
                />
                <div className="grid min-w-0 gap-0.5">
                  <label htmlFor={id} className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                    {o.score !== null ? <span className="text-[11px] font-normal text-muted-foreground tabular">#{i + 1}</span> : null}
                    {o.label}
                    <Badge variant={risk.variant}>
                      <RiskIcon aria-hidden />
                      {risk.label}
                    </Badge>
                  </label>
                  <p id={`${id}-reason`} className="text-[11px] text-muted-foreground">
                    {o.reason ?? "Chosen earlier; not suggested for the current material."}
                  </p>
                  {o.caution ? (
                    <p className="flex items-start gap-1 text-[11px] text-warning">
                      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                      {o.caution}
                    </p>
                  ) : null}
                </div>
                <span className="text-right" title="Fit score (0–100) from the editorial alternatives rules">
                  <span className="block text-sm font-semibold tabular">{o.score ?? "—"}</span>
                  <span className="block text-[10px] text-muted-foreground">fit</span>
                </span>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {footageChosen ? (
        <p className="flex items-start gap-1.5 text-[11px] text-warning" role="status">
          <ShieldAlert className="mt-px size-3 shrink-0" aria-hidden />
          Footage-based formats clear no asset: each one still needs GREEN, or YELLOW approved by a person, in the Rights Center. Automated
          workflows only use GREEN.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="brand" disabled={pending} data-testid="save-production-formats">
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          Save production plan
        </Button>
        <span className="text-[11px] text-muted-foreground tabular">{chosen.size} selected</span>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
