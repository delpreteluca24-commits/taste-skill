"use client";

import { useActionState, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { CircleCheck, CircleX, Info, Lightbulb, Loader2, Save, TriangleAlert } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { classifyAsset } from "@/lib/rights/actions";
import { greenBasisMissing, OWNERSHIP_OPTIONS, suggestRightsStatus, type Ownership } from "@/lib/rights/classify";
import {
  COMMERCIAL_USE_OPTIONS,
  factsFromFields,
  parseCommercialUse,
  RIGHTS_STATUSES,
  type AssetType,
  type ClassifiedStatus,
  type CommercialUseValue,
} from "@/lib/rights/schema";
import { cn } from "@/lib/utils";

import { RIGHTS_STATUS_META, RightsStatusBadge } from "./badges";

export type ClassificationValues = {
  status: ClassifiedStatus | "";
  ownership: Ownership;
  owner: string;
  sourceDetail: string;
  license: string;
  commercialUse: CommercialUseValue;
  authorization: string;
  transformationRequired: boolean;
  risk: string;
  evidenceUrl: string;
  notes: string;
};

const RISK_SUGGESTIONS = ["Low", "Medium", "High", "Broadcast / league footage", "Takedown notice received", "Copyright claim on file"];

function Field({ id, label, hint, errors, children }: { id: string; label: string; hint?: string; errors?: string[]; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <FieldError messages={errors} />
    </div>
  );
}

/**
 * Records a GREEN / YELLOW / RED classification with the ten rights-first
 * fields. The panel next to it suggests a status LIVE from the same facts
 * (lib/rights/classify.ts); a person always decides, and the database refuses
 * a GREEN without a documented basis. Every field is controlled, so a refused
 * submission never loses what was typed.
 */
export function ClassificationForm({
  assetType,
  assetId,
  licenseStatus,
  initial,
}: {
  assetType: AssetType;
  assetId: string;
  /** the source's license_status (e.g. 'restricted' forces a RED suggestion) */
  licenseStatus: string | null;
  initial: ClassificationValues;
}) {
  const [state, action, pending] = useActionState(classifyAsset, null);
  const [v, setV] = useState<ClassificationValues>(initial);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const set =
    <K extends keyof ClassificationValues>(key: K) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setV((prev) => ({ ...prev, [key]: value }));
    };

  const facts = useMemo(
    () =>
      factsFromFields(
        {
          ownership: v.ownership,
          commercialUse: parseCommercialUse(v.commercialUse),
          evidenceUrl: v.evidenceUrl.trim() || null,
          authorization: v.authorization.trim() || null,
          license: v.license.trim() || null,
          transformationRequired: v.transformationRequired,
          risk: v.risk.trim() || null,
        },
        licenseStatus,
      ),
    [v.ownership, v.commercialUse, v.evidenceUrl, v.authorization, v.license, v.transformationRequired, v.risk, licenseStatus],
  );
  const suggestion = useMemo(() => suggestRightsStatus(facts), [facts]);
  const missing = useMemo(() => greenBasisMissing(facts), [facts]);
  const greenBlocked = v.status === "green" && missing.length > 0;
  const differs = v.status !== "" && v.status !== suggestion.status;

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]" data-testid="classification-form">
      <input type="hidden" name="assetType" value={assetType} />
      <input type="hidden" name="assetId" value={assetId} />

      <div className="grid min-w-0 content-start gap-3">
        <fieldset disabled={pending} className="grid gap-2" aria-describedby="status-help">
          <legend className="mb-1.5 text-xs font-medium">Classification</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {RIGHTS_STATUSES.map((s) => {
              const meta = RIGHTS_STATUS_META[s];
              const Icon = meta.icon;
              return (
                <label
                  key={s}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-accent/40",
                    v.status === s && s === "green" && "border-success/60 bg-success/10",
                    v.status === s && s === "yellow" && "border-warning/60 bg-warning/10",
                    v.status === s && s === "red" && "border-danger/60 bg-danger/10",
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    checked={v.status === s}
                    onChange={set("status")}
                    className="mt-0.5 size-3.5 accent-brand"
                    data-testid={`status-${s}`}
                  />
                  <span className="grid gap-0.5">
                    <span className="flex items-center gap-1 font-semibold">
                      <Icon className="size-3.5" aria-hidden />
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{meta.rule}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p id="status-help" className="text-[11px] text-muted-foreground">
            Recording a classification adds a new check to the history; the latest one decides the asset&apos;s rights.
          </p>
          <FieldError messages={errors?.status} />
          {greenBlocked ? (
            <p className="flex items-start gap-1.5 text-[11px] text-warning" role="status">
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              GREEN is not possible yet: {missing.join("; ")}.
            </p>
          ) : null}
        </fieldset>

        <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
          <Field id="rc-ownership" label="Ownership" hint="Who holds the rights, in rights-first terms." errors={errors?.ownership}>
            <NativeSelect id="rc-ownership" name="ownership" value={v.ownership} onChange={set("ownership")} aria-invalid={errors?.ownership ? true : undefined}>
              {OWNERSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rc-owner" label="Rights holder" hint="e.g. club, league, photographer, creator." errors={errors?.owner}>
            <Input id="rc-owner" name="owner" maxLength={200} value={v.owner} onChange={set("owner")} />
          </Field>
          <Field id="rc-source" label="Source" hint="Where the asset comes from: channel, archive, agency, upload." errors={errors?.sourceDetail}>
            <Input id="rc-source" name="sourceDetail" maxLength={500} value={v.sourceDetail} onChange={set("sourceDetail")} />
          </Field>
          <Field id="rc-license" label="License" hint="Terms, e.g. editorial + social, 12 months, CC BY 4.0." errors={errors?.license}>
            <Input id="rc-license" name="license" maxLength={1000} value={v.license} onChange={set("license")} />
          </Field>
          <Field id="rc-commercial" label="Commercial use" hint="Monetized channels count as commercial use." errors={errors?.commercialUse}>
            <NativeSelect
              id="rc-commercial"
              name="commercialUse"
              value={v.commercialUse}
              onChange={set("commercialUse")}
              aria-invalid={errors?.commercialUse ? true : undefined}
            >
              {COMMERCIAL_USE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rc-risk" label="Risk" hint="Level or known issue (takedowns, claims, broadcast footage)." errors={errors?.risk}>
            <Input id="rc-risk" name="risk" list="rc-risk-options" maxLength={500} value={v.risk} onChange={set("risk")} />
            <datalist id="rc-risk-options">
              {RISK_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <div className="sm:col-span-2">
            <Field id="rc-authorization" label="Authorization" hint="Permission on file: who granted it, scope, date." errors={errors?.authorization}>
              <Textarea id="rc-authorization" name="authorization" rows={2} maxLength={2000} value={v.authorization} onChange={set("authorization")} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              id="rc-evidence"
              label="Evidence link"
              hint="License, contract, email or written permission. Required for GREEN unless owned or public domain."
              errors={errors?.evidenceUrl}
            >
              <Input
                id="rc-evidence"
                name="evidenceUrl"
                type="url"
                maxLength={2048}
                placeholder="https://…"
                value={v.evidenceUrl}
                onChange={set("evidenceUrl")}
                aria-invalid={errors?.evidenceUrl ? true : undefined}
              />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              name="transformationRequired"
              checked={v.transformationRequired}
              onChange={set("transformationRequired")}
              className="mt-0.5 size-3.5 accent-brand"
            />
            <span>
              <span className="font-medium">Transformation required</span>
              <span className="block text-[11px] text-muted-foreground">Usable only transformed (commentary, edit, overlay), never as-is.</span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <Field id="rc-notes" label="Notes" hint="Anything a reviewer should know, incl. why you differ from the suggestion." errors={errors?.notes}>
              <Textarea id="rc-notes" name="notes" rows={3} maxLength={4000} value={v.notes} onChange={set("notes")} />
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" variant="brand" disabled={pending} data-testid="classify-submit">
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            Record classification
          </Button>
          <FormMessage state={state} className="py-1" />
        </div>
      </div>

      <aside className="grid content-start gap-3 rounded-md border bg-secondary/30 p-3 text-xs" aria-live="polite" data-testid="rights-suggestion">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-medium">
            <Lightbulb className="size-3.5 text-brand" aria-hidden />
            Suggested
          </p>
          <RightsStatusBadge status={suggestion.status} />
        </div>
        <ul className="grid gap-1 text-[11px] text-muted-foreground" aria-label="Why">
          {suggestion.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {suggestion.conditions.length ? (
          <div className="grid gap-1">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Conditions</p>
            <ul className="grid gap-1 text-[11px]">
              {suggestion.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-1" data-testid="green-allowed" data-allowed={missing.length === 0}>
          <p className="flex items-center gap-1.5 font-medium">
            {missing.length === 0 ? (
              <CircleCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <CircleX className="size-3.5 text-danger" aria-hidden />
            )}
            {missing.length === 0 ? "GREEN is allowed" : "GREEN not allowed yet"}
          </p>
          {missing.length ? (
            <ul className="grid list-disc gap-0.5 pl-4 text-[11px] text-muted-foreground">
              {missing.map((m) => (
                <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {differs ? (
          <p className="flex items-start gap-1.5 text-[11px] text-warning">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
            Your choice differs from the suggestion: explain why in the notes.
          </p>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending || v.status === suggestion.status}
          onClick={() => setV((prev) => ({ ...prev, status: suggestion.status }))}
        >
          Use suggestion
        </Button>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          Computed from the facts above by a documented rule, not by AI. A person always records the classification.
        </p>
      </aside>
    </form>
  );
}
