import type { ReactNode } from "react";
import { CircleDot, FileText, KeyRound, Layers, Settings2, Terminal, TriangleAlert } from "lucide-react";

import { FieldError } from "@/components/common/form-feedback";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { EFFORTS } from "@/lib/ai/types";

import { formatCost, formatPricePerMillion, formatTokens, sourceLabel, taskFieldName, type TaskField } from "./ai-format";
import type { ModelSuggestion, TaskRoutingView } from "./ai-routing";

/**
 * Per-task routing rows for Settings → AI (rendered inside the settings form).
 * Everything shown is resolved on the server: effective model + where it comes
 * from (Settings > env > default), fallback chain, effort, price and an
 * indicative cost. Inputs hold only the stored overrides; empty = inherit.
 */

type FieldErrors = Record<string, string[] | undefined> | undefined;

export const MODEL_DATALIST_ID = "ai-model-suggestions";

export function ModelSuggestionList({ suggestions }: { suggestions: ModelSuggestion[] }) {
  return (
    <datalist id={MODEL_DATALIST_ID}>
      {suggestions.map((s) => (
        <option key={s.value} value={s.value} label={s.label} />
      ))}
    </datalist>
  );
}

export function TaskRoutingRows({ routing, errors }: { routing: TaskRoutingView[]; errors: FieldErrors }) {
  return (
    <div className="grid gap-2" data-testid="ai-task-routing">
      {routing.map((view) => (
        <TaskRoutingRow key={view.task} view={view} errors={errors} />
      ))}
    </div>
  );
}

function SourceBadge({ view }: { view: TaskRoutingView }) {
  const icon = view.source === "settings" ? <Settings2 /> : view.source === "env" ? <Terminal /> : <CircleDot />;
  return (
    <Badge variant={view.source === "settings" ? "info" : view.source === "env" ? "secondary" : "outline"}>
      {icon}
      {sourceLabel(view.source, view.envVar)}
    </Badge>
  );
}

function TaskRoutingRow({ view: r, errors }: { view: TaskRoutingView; errors: FieldErrors }) {
  const id = (field: TaskField) => `ai-${r.task}-${field}`;
  const err = (field: TaskField) => errors?.[taskFieldName(r.task, field)];

  return (
    <fieldset className="grid min-w-0 gap-2.5 rounded-md border px-3 py-2.5" data-testid={`ai-task-${r.task}`}>
      <legend className="sr-only">{r.label} model routing</legend>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
            {r.label}
            <Badge variant="outline">
              {r.volume === "batch" ? <Layers /> : <FileText />}
              {r.volume === "batch" ? "Batch" : "Per item"}
            </Badge>
          </p>
          <p className="text-[11px] text-muted-foreground">{r.description}</p>
        </div>
        <div className="text-[11px] text-muted-foreground tabular sm:text-right" data-testid={`ai-task-${r.task}-cost`}>
          {r.price ? (
            <p>
              <span className="text-foreground">{formatPricePerMillion(r.price)}</span> per 1M tokens in / out
            </p>
          ) : (
            <Badge variant="warning">
              <TriangleAlert />
              Unpriced — cost not tracked
            </Badge>
          )}
          <p>
            ≈ <span className="text-foreground">{formatCost(r.costPer100Calls)}</span> per 100 calls
            <span className="block text-[10px]">
              typical call: {formatTokens(r.typical.inputTokens)} in · {formatTokens(r.typical.outputTokens)} out tokens
            </span>
          </p>
        </div>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[8.5rem_1fr]">
        <dt className="text-muted-foreground">Effective model</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          <code className="break-all text-foreground" data-testid={`ai-task-${r.task}-model`}>
            {r.model}
          </code>
          <SourceBadge view={r} />
          {r.providerConfigured ? null : (
            <Badge variant="warning">
              <KeyRound />
              No {r.model.split(":")[0]} API key — calls are skipped
            </Badge>
          )}
        </dd>
        <dt className="text-muted-foreground">Fallback chain</dt>
        <dd className="min-w-0 break-all">{r.fallbacks.length ? r.fallbacks.join(" → ") : "None"}</dd>
        <dt className="text-muted-foreground">Effort · output cap</dt>
        <dd>
          {r.effort} ({r.effortSource === "settings" ? "Settings" : "default"}) · ≤ {formatTokens(r.maxOutputTokens)} tokens
        </dd>
      </dl>

      {r.needsBenchmark ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            {r.costVsDefault !== null ? `×${r.costVsDefault} the cost of the default (${r.defaultModel})` : "Unpriced model"} on a batch
            task. Measure first: <code>npm run ai:benchmark -- --task {r.task}</code>, then keep the cheaper model if quality holds.
          </span>
        </p>
      ) : r.costVsDefault !== null ? (
        <p className="text-[11px] text-muted-foreground">
          ×{r.costVsDefault} the cost of the default ({r.defaultModel}).
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem]">
        <RowField id={id("model")} label="Model override" taskLabel={r.label} errors={err("model")}>
          <Input
            id={id("model")}
            name={taskFieldName(r.task, "model")}
            list={MODEL_DATALIST_ID}
            defaultValue={r.override.model}
            placeholder={`Inherit · ${r.inheritedModel}`}
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            aria-invalid={err("model") ? true : undefined}
          />
        </RowField>
        <RowField id={id("fallback")} label="Fallback model" taskLabel={r.label} errors={err("fallback")}>
          <Input
            id={id("fallback")}
            name={taskFieldName(r.task, "fallback")}
            list={MODEL_DATALIST_ID}
            defaultValue={r.override.fallback}
            placeholder="Optional · provider:model"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            aria-invalid={err("fallback") ? true : undefined}
          />
        </RowField>
        <RowField id={id("effort")} label="Effort" taskLabel={r.label} errors={err("effort")}>
          <NativeSelect id={id("effort")} name={taskFieldName(r.task, "effort")} defaultValue={r.override.effort} aria-invalid={err("effort") ? true : undefined}>
            <option value="">Inherit ({r.defaultEffort})</option>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </NativeSelect>
        </RowField>
      </div>
    </fieldset>
  );
}

function RowField({
  id,
  label,
  taskLabel,
  errors,
  children,
}: {
  id: string;
  label: string;
  taskLabel: string;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-[11px]">
        {label}
        <span className="sr-only"> for {taskLabel}</span>
      </Label>
      {children}
      <FieldError messages={errors} />
    </div>
  );
}
