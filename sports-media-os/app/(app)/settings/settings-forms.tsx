"use client";

import { useActionState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { FieldError, FormMessage } from "@/components/common/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  ASPECT_RATIOS,
  CAPTION_PRESETS,
  WHISPER_MODELS,
  type SettingsSection,
  type WorkspaceSettings,
} from "@/lib/settings/schema";

import { saveSettingsSection } from "./actions";

type FieldErrors = Record<string, string[] | undefined> | undefined;

function SectionForm({
  section,
  disabled,
  children,
}: {
  section: SettingsSection;
  disabled: boolean;
  children: (errors: FieldErrors) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(saveSettingsSection, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="grid gap-3" data-testid={`settings-${section}`}>
      <input type="hidden" name="section" value={section} />
      <fieldset disabled={disabled || pending} className="grid gap-3">
        {children(errors)}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        <FormMessage state={state} className="py-1" />
      </div>
    </form>
  );
}

function Field({ id, label, errors, children }: { id: string; label: string; errors?: string[]; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldError messages={errors} />
    </div>
  );
}

export function AiSettingsForm({ value, disabled }: { value: WorkspaceSettings["ai"]; disabled: boolean }) {
  // placeholder until the per-task routing UI lands (M2 Settings module)
  return (
    <SectionForm section="ai" disabled={disabled}>
      {(errors) => (
        <Field id="batchCostLimitUsd" label="Batch cost limit (USD)" errors={errors?.batchCostLimitUsd}>
          <Input id="batchCostLimitUsd" name="batchCostLimitUsd" type="number" min={0} step="0.01" defaultValue={value.batchCostLimitUsd} />
        </Field>
      )}
    </SectionForm>
  );
}

export function TranscriptionSettingsForm({
  value,
  disabled,
}: {
  value: WorkspaceSettings["transcription"];
  disabled: boolean;
}) {
  return (
    <SectionForm section="transcription" disabled={disabled}>
      {(errors) => (
        <Field id="whisperModel" label="faster-whisper model" errors={errors?.whisperModel}>
          <NativeSelect id="whisperModel" name="whisperModel" defaultValue={value.whisperModel}>
            {WHISPER_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </SectionForm>
  );
}

export function ProductionSettingsForm({
  value,
  disabled,
}: {
  value: WorkspaceSettings["production"];
  disabled: boolean;
}) {
  return (
    <SectionForm section="production" disabled={disabled}>
      {(errors) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="captionPreset" label="Caption preset" errors={errors?.captionPreset}>
            <NativeSelect id="captionPreset" name="captionPreset" defaultValue={value.captionPreset}>
              {CAPTION_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="aspectRatio" label="Default aspect ratio" errors={errors?.aspectRatio}>
            <NativeSelect id="aspectRatio" name="aspectRatio" defaultValue={value.aspectRatio}>
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="clipDurationSec" label="Default clip duration (s)" errors={errors?.clipDurationSec}>
            <Input id="clipDurationSec" name="clipDurationSec" type="number" min={10} max={180} defaultValue={value.clipDurationSec} />
          </Field>
        </div>
      )}
    </SectionForm>
  );
}

export function ThresholdSettingsForm({
  value,
  disabled,
}: {
  value: WorkspaceSettings["thresholds"];
  disabled: boolean;
}) {
  return (
    <SectionForm section="thresholds" disabled={disabled}>
      {(errors) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="minOpportunityScore" label="Min opportunity score (0-100)" errors={errors?.minOpportunityScore}>
            <Input id="minOpportunityScore" name="minOpportunityScore" type="number" min={0} max={100} step={1} defaultValue={value.minOpportunityScore} />
          </Field>
          <Field id="minViralityScore" label="Min virality potential (0-100)" errors={errors?.minViralityScore}>
            <Input id="minViralityScore" name="minViralityScore" type="number" min={0} max={100} step={1} defaultValue={value.minViralityScore} />
          </Field>
        </div>
      )}
    </SectionForm>
  );
}

export function PublishingSettingsForm({
  value,
  disabled,
}: {
  value: WorkspaceSettings["publishing"];
  disabled: boolean;
}) {
  return (
    <SectionForm section="publishing" disabled={disabled}>
      {() => (
        <div className="flex items-start gap-3">
          <Switch id="autoPublish" name="autoPublish" defaultChecked={value.autoPublish} />
          <div className="grid gap-1">
            <Label htmlFor="autoPublish">Auto publish</Label>
            <p className="text-[11px] text-muted-foreground">
              Off = every publish needs a human approval (recommended). Even when on, content must pass the READY gate
              (confirmed critical facts, safe rights).
            </p>
          </div>
        </div>
      )}
    </SectionForm>
  );
}
