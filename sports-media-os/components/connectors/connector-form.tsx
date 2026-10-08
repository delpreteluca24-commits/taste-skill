"use client";

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { saveConnectorAction } from "@/lib/connectors/actions";
import { MAPPING_FIELDS, type MappingField } from "@/lib/connectors/config";
import { CONNECTOR_KINDS, KIND_LABELS, LICENSE_STATUSES, MAPPING_LABELS, TARGET_LABELS } from "@/lib/connectors/schema";

export type ConnectorFormValues = {
  id?: string;
  name: string;
  kind: (typeof CONNECTOR_KINDS)[number];
  url: string;
  target: "sources" | "events";
  sportId: string | null;
  credibility: number | null;
  defaultLicense: (typeof LICENSE_STATUSES)[number];
  fetchIntervalMinutes: number;
  enabled: boolean;
  mapping: Partial<Record<MappingField, string>>;
};

export const EMPTY_CONNECTOR: ConnectorFormValues = {
  name: "",
  kind: "rss",
  url: "",
  target: "sources",
  sportId: null,
  credibility: null,
  defaultLicense: "unknown",
  fetchIntervalMinutes: 60,
  enabled: true,
  mapping: {},
};

const LICENSE_LABELS: Record<(typeof LICENSE_STATUSES)[number], string> = {
  unknown: "Unknown (classify in Rights Center)",
  owned: "Owned",
  licensed: "Licensed",
  public_domain: "Public domain",
  creative_commons: "Creative Commons",
  fair_use_review: "Needs fair-use review",
  restricted: "Restricted",
};

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
 * Create / edit a connector. Submitted from onSubmit (not <form action>) so a
 * validation error keeps what the user typed. Saving redirects to the list.
 */
export function ConnectorForm({ value, sports }: { value: ConnectorFormValues; sports: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(saveConnectorAction, null);
  const [kind, setKind] = useState(value.kind);
  const [target, setTarget] = useState(value.target);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const isEdit = Boolean(value.id);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const invalid = (field: string) => (errors?.[field]?.length ? true : undefined);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" data-testid="connector-form" noValidate>
      {value.id ? <input type="hidden" name="id" value={value.id} /> : null}
      <fieldset disabled={pending} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="connector-name" label="Name" errors={errors?.name}>
            <Input id="connector-name" name="name" defaultValue={value.name} maxLength={120} required aria-invalid={invalid("name")} placeholder="e.g. Football headlines" />
          </Field>
          <Field id="connector-url" label="Feed or API URL" hint="Public http(s) URL. Private and internal addresses are refused." errors={errors?.url}>
            <Input
              id="connector-url"
              name="url"
              type="url"
              inputMode="url"
              defaultValue={value.url}
              maxLength={2048}
              required
              aria-invalid={invalid("url")}
              placeholder="https://example.com/sport/rss.xml"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="connector-kind" label="Type" errors={errors?.kind}>
            <NativeSelect
              id="connector-kind"
              name="kind"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as ConnectorFormValues["kind"];
                setKind(next);
                if (next === "rss") setTarget("sources");
              }}
            >
              {CONNECTOR_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="connector-target" label="Creates" hint={kind === "rss" ? "Feeds always create sources." : undefined} errors={errors?.target}>
            <NativeSelect id="connector-target" name="target" value={target} onChange={(e) => setTarget(e.target.value as ConnectorFormValues["target"])}>
              <option value="sources">{TARGET_LABELS.sources}</option>
              <option value="events" disabled={kind === "rss"}>
                {TARGET_LABELS.events}
              </option>
            </NativeSelect>
          </Field>
          <Field id="connector-sport" label="Sport" errors={errors?.sportId}>
            <NativeSelect id="connector-sport" name="sportId" defaultValue={value.sportId ?? ""}>
              <option value="">Not set</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="connector-credibility" label="Credibility (0–1)" hint="Your assessment of this publisher. Empty = not rated." errors={errors?.credibility}>
            <Input
              id="connector-credibility"
              name="credibility"
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={value.credibility ?? ""}
              aria-invalid={invalid("credibility")}
            />
          </Field>
          <Field id="connector-license" label="Default license" hint="A hint only: every item starts UNCHECKED." errors={errors?.defaultLicense}>
            <NativeSelect id="connector-license" name="defaultLicense" defaultValue={value.defaultLicense}>
              {LICENSE_STATUSES.map((l) => (
                <option key={l} value={l}>
                  {LICENSE_LABELS[l]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="connector-interval" label="Fetch every (minutes)" hint="15 to 1440." errors={errors?.fetchIntervalMinutes}>
            <Input
              id="connector-interval"
              name="fetchIntervalMinutes"
              type="number"
              min={15}
              max={1440}
              step={1}
              defaultValue={value.fetchIntervalMinutes}
              required
              aria-invalid={invalid("fetchIntervalMinutes")}
            />
          </Field>
        </div>

        <div className="flex items-start gap-3">
          <Switch id="connector-enabled" name="enabled" defaultChecked={value.enabled} />
          <div className="grid gap-1">
            <Label htmlFor="connector-enabled">Enabled</Label>
            <p className="text-[11px] text-muted-foreground">Enabled connectors are fetched by the background worker on their interval.</p>
          </div>
        </div>

        {kind === "json_api" ? (
          <fieldset className="grid gap-3 rounded-md border p-3" data-testid="json-mapping">
            <legend className="px-1 text-xs font-medium">JSON field mapping</legend>
            <p className="text-[11px] text-muted-foreground">
              Dot paths into each item of the response, e.g. <code className="text-foreground">links.web</code> or{" "}
              <code className="text-foreground">teams.0.name</code>. Only mapped fields are read — nothing is guessed.
              {target === "events" ? " Comma-separate two title paths to build “Home vs Away”." : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {MAPPING_FIELDS[target].map((field) => {
                const required = field === "titlePath" || (target === "sources" && field === "urlPath");
                return (
                  <Field key={field} id={`mapping-${field}`} label={`${MAPPING_LABELS[field].label}${required ? "" : " (optional)"}`} errors={errors?.[field]}>
                    <Input
                      id={`mapping-${field}`}
                      name={field}
                      defaultValue={value.mapping[field] ?? ""}
                      placeholder={MAPPING_LABELS[field].placeholder}
                      maxLength={400}
                      aria-invalid={invalid(field)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {isEdit ? "Save changes" : "Add connector"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/radar/connectors">Cancel</Link>
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}
