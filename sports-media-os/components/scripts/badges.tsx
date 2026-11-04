import {
  BookOpen,
  ChartColumn,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleX,
  Clock,
  EyeOff,
  Info,
  Maximize2,
  Palette,
  PenLine,
  Pin,
  RefreshCw,
  Scale,
  Scissors,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Type,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { scoreBand } from "@/lib/dashboard/format";
import type { Enums } from "@/lib/db/client";
import { FACT_STATUS_VIEW } from "@/lib/factcheck/presentation";
import { WARNING_LABELS, type ScriptWarning } from "@/lib/scripts/grounding";
import {
  ANGLE_LABELS,
  HOOK_TYPE_LABELS,
  OPERATION_LABELS,
  SCRIPT_SECTIONS,
  type HookType,
  type ScriptAngle,
  type ScriptOperation,
  type ScriptSections,
} from "@/lib/scripts/schema";
import type { StoryFact } from "@/lib/scripts/service";
import { cn } from "@/lib/utils";

/** Script & Hook Studio badges: always icon + label, never color alone. */

export function DecisionBadge({ decision }: { decision: Enums<"approval_decision"> | null }) {
  if (decision === "approved") {
    return (
      <Badge variant="success" data-testid="script-decision" data-decision="approved">
        <CircleCheck aria-hidden />
        Approved
      </Badge>
    );
  }
  if (decision === "rejected") {
    return (
      <Badge variant="danger" data-testid="script-decision" data-decision="rejected">
        <CircleX aria-hidden />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline" data-testid="script-decision" data-decision="none" title="A person approves or rejects the current version; agents never do.">
      <Clock aria-hidden />
      Awaiting approval
    </Badge>
  );
}

export function CurrentBadge() {
  return (
    <Badge variant="info" title="The version production uses (after approval)">
      <Pin aria-hidden />
      Current
    </Badge>
  );
}

const OPERATION_ICON: Record<ScriptOperation, LucideIcon> = {
  generate: Sparkles,
  regenerate: RefreshCw,
  shorten: Scissors,
  expand: Maximize2,
  rewrite_hook: Type,
  change_tone: Palette,
  manual: PenLine,
};

export function OperationBadge({ operation }: { operation: ScriptOperation }) {
  const Icon = OPERATION_ICON[operation];
  return (
    <Badge variant="secondary" data-operation={operation}>
      <Icon aria-hidden />
      {OPERATION_LABELS[operation]}
    </Badge>
  );
}

export function angleLabel(angle: ScriptAngle | null): string {
  return angle ? ANGLE_LABELS[angle].label : "No angle";
}

const HOOK_TYPE_ICON: Record<HookType, LucideIcon> = {
  curiosity: CircleHelp,
  controversial: Scale,
  shock: Zap,
  mystery: EyeOff,
  story: BookOpen,
  statistical: ChartColumn,
};

export function HookTypeBadge({ type }: { type: HookType }) {
  const Icon = HOOK_TYPE_ICON[type];
  return (
    <Badge variant="outline" title={HOOK_TYPE_LABELS[type].description} data-hook-type={type}>
      <Icon aria-hidden />
      {HOOK_TYPE_LABELS[type].label}
    </Badge>
  );
}

const BAND_VIEW = {
  high: { variant: "success", label: "strong" },
  medium: { variant: "warning", label: "fair" },
  low: { variant: "danger", label: "weak" },
  none: { variant: "outline", label: "not scored" },
} as const;

/** 0–100 hook score with its band in words (≥70 strong, 50–69 fair, <50 weak). */
export function HookScoreBadge({ score }: { score: number | null }) {
  const band = scoreBand(score, 70);
  const v = BAND_VIEW[band];
  return (
    <Badge variant={v.variant} className="tabular" title={`Hook score: ${score ?? "—"} (${v.label})`} data-testid="hook-score">
      {score ?? "—"}
      <span className="font-normal">{v.label}</span>
    </Badge>
  );
}

/** The six sections, in reading order. */
export function ScriptSectionsView({ sections, className }: { sections: ScriptSections; className?: string }) {
  return (
    <dl className={cn("grid gap-2.5", className)} data-testid="script-sections">
      {SCRIPT_SECTIONS.map((s) => (
        <div key={s.key} className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr] sm:gap-3">
          <dt className="pt-px text-[10px] font-medium tracking-wide text-muted-foreground uppercase" title={s.hint}>
            {s.label}
          </dt>
          <dd className={cn("text-[13px] leading-relaxed whitespace-pre-line", s.key === "hook" && "font-medium text-foreground")}>
            {sections[s.key] || <span className="text-muted-foreground italic">Empty</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const SEVERITY_ICON = { danger: ShieldAlert, warning: TriangleAlert, info: Info } as const;
const SEVERITY_CLASS = { danger: "text-danger", warning: "text-warning", info: "text-info" } as const;

/** Grounding warnings stored on the version: what a reviewer must check before approving. */
export function WarningsPanel({ warnings }: { warnings: readonly ScriptWarning[] }) {
  if (warnings.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="script-warnings" data-count={0}>
        <CircleCheck className="size-3.5 text-success" aria-hidden />
        Grounding check: no warnings. Every number and quote matches the research.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid="script-warnings" data-count={warnings.length}>
      <p className="text-[11px] font-medium tracking-wide text-warning uppercase">Check before approving</p>
      <ul className="grid gap-1.5">
        {warnings.map((w, i) => {
          const view = WARNING_LABELS[w.kind];
          const Icon = SEVERITY_ICON[view.severity];
          return (
            <li key={i} className="flex items-start gap-1.5 text-xs" data-kind={w.kind}>
              <Icon className={cn("mt-px size-3.5 shrink-0", SEVERITY_CLASS[view.severity])} aria-hidden />
              <span className="min-w-0">
                <span className="font-medium">{view.label}: </span>
                <span className="text-muted-foreground">{w.message}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const FACT_ICON: Record<Enums<"fact_status">, LucideIcon> = {
  confirmed: CircleCheck,
  probable: CircleDot,
  uncertain: CircleHelp,
  false: CircleX,
};

/** Facts a version cites, with their CURRENT verification status. */
export function FactChips({ ids, facts }: { ids: readonly string[]; facts: Readonly<Record<string, StoryFact>> }) {
  if (ids.length === 0) {
    return <p className="text-[11px] text-muted-foreground">Cites no research facts.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Facts used" data-testid="facts-used">
      {ids.map((id) => {
        const f = facts[id];
        if (!f) {
          return (
            <li key={id}>
              <Badge variant="outline" title="This claim is no longer in the research">
                <CircleX aria-hidden />
                Removed claim
              </Badge>
            </li>
          );
        }
        const view = FACT_STATUS_VIEW[f.status];
        const Icon = FACT_ICON[f.status];
        return (
          <li key={id} className="max-w-full">
            <Badge variant={view.variant} className="max-w-full whitespace-normal text-left" title={`${view.label}: ${f.claim}`}>
              <Icon aria-hidden />
              <span className="sr-only">{view.label}: </span>
              <span className="line-clamp-1 min-w-0 font-normal">{f.claim}</span>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
