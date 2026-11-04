import {
  BarChart3,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clapperboard,
  Clock,
  FileText,
  Film,
  Hourglass,
  Lightbulb,
  ListChecks,
  Lock,
  MonitorPlay,
  OctagonAlert,
  PackageCheck,
  PenLine,
  Search,
  Send,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ScriptState, StageAge } from "@/lib/content/board";
import { FORMAT_HINTS, FORMAT_LABELS, type ContentFormat } from "@/lib/content/schema";
import { STAGE_LABELS, type ContentStage } from "@/lib/content/stages";
import { formatScore, scoreBand } from "@/lib/dashboard/format";
import type { Enums } from "@/lib/db/client";
import { cn } from "@/lib/utils";

/** Content badges: always icon + label, never color alone. */

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

export const STAGE_ICONS: Record<ContentStage, LucideIcon> = {
  idea: Lightbulb,
  research: Search,
  script: PenLine,
  review: ListChecks,
  production: Clapperboard,
  ready: PackageCheck,
  scheduled: CalendarClock,
  published: Send,
  analyzing: BarChart3,
};

export function StageBadge({ stage }: { stage: ContentStage }) {
  const Icon = STAGE_ICONS[stage];
  return (
    <Badge variant="secondary" data-testid="content-stage" data-stage={stage}>
      <Icon aria-hidden />
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

const FORMAT_ICONS: Record<ContentFormat, LucideIcon> = { short: Smartphone, long: MonitorPlay, post: FileText };

export function FormatBadge({ format }: { format: ContentFormat }) {
  const Icon = FORMAT_ICONS[format] ?? Film;
  return (
    <Badge variant="outline" title={FORMAT_HINTS[format]} data-format={format}>
      <Icon aria-hidden />
      {FORMAT_LABELS[format] ?? format}
    </Badge>
  );
}

const SCRIPT: Record<ScriptState, { label: string; icon: LucideIcon; variant: BadgeVariant; title: string }> = {
  approved: { label: "Script approved", icon: CircleCheck, variant: "success", title: "The current script is approved: production is open." },
  pending: {
    label: "Script pending",
    icon: Clock,
    variant: "warning",
    title: "The current script waits for a person's decision. PRODUCTION is refused until it is approved.",
  },
  rejected: {
    label: "Script rejected",
    icon: CircleX,
    variant: "danger",
    title: "The current script was rejected. Write or generate a new version and approve it.",
  },
  missing: { label: "No script", icon: CircleDashed, variant: "outline", title: "The story has no script yet." },
  no_story: { label: "No story", icon: CircleDashed, variant: "outline", title: "No story linked yet. Create it on the item page." },
};

export function ScriptStateBadge({ state }: { state: ScriptState }) {
  const s = SCRIPT[state];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} title={s.title} data-testid="script-state" data-state={state}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

export function BlockersBadge({ count, blockers }: { count: number; blockers?: readonly string[] }) {
  if (count === 0) {
    return (
      <Badge variant="success" title="Nothing blocks READY" data-testid="blockers" data-count={0}>
        <CircleCheck aria-hidden />
        No blockers
      </Badge>
    );
  }
  return (
    <Badge variant="danger" title={blockers?.length ? blockers.join(" · ") : undefined} data-testid="blockers" data-count={count}>
      <OctagonAlert aria-hidden />
      {count} blocker{count === 1 ? "" : "s"}
    </Badge>
  );
}

const STORY_STATUS: Record<Enums<"story_status">, { label: string; icon: LucideIcon; variant: BadgeVariant }> = {
  draft: { label: "Draft", icon: PenLine, variant: "outline" },
  review: { label: "In review", icon: ListChecks, variant: "info" },
  approved: { label: "Approved", icon: CircleCheck, variant: "success" },
  rejected: { label: "Rejected", icon: CircleX, variant: "danger" },
};

export function StoryStatusBadge({ status }: { status: Enums<"story_status"> }) {
  const s = STORY_STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} data-testid="story-status" data-status={status}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

const BAND_CLASS = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-danger/30 bg-danger/10 text-danger",
  none: "bg-secondary/50 text-muted-foreground",
} as const;

/** Compact opportunity score chip for cards (the number is the label; color only reinforces it). */
export function OpportunityScoreChip({ score, threshold = 70 }: { score: number | null; threshold?: number }) {
  const band = scoreBand(score, threshold);
  return (
    <span
      className={cn("inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 text-[11px] font-semibold tabular", BAND_CLASS[band])}
      title={score === null ? "Opportunity not scored" : `Opportunity score ${formatScore(score)} of 100 (threshold ${threshold})`}
      aria-label={score === null ? "Opportunity not scored" : `Opportunity score ${formatScore(score)} of 100`}
      data-testid="opportunity-score"
    >
      {formatScore(score)}
    </span>
  );
}

/** Time in the current stage; stalled cards say so in words. */
export function StageAgeLabel({ age, className }: { age: StageAge; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[11px] tabular", age.stalled ? "text-warning" : "text-muted-foreground", className)}
      title={age.stalled ? `In this stage for ${age.days} days: stalled` : "Time in this stage"}
      data-testid="stage-age"
    >
      <Hourglass className="size-3" aria-hidden />
      {age.label === "now" ? "just moved" : `${age.label} in stage`}
      {age.stalled ? " · stalled" : ""}
    </span>
  );
}

/** Column-header marker for a DB gate on entry (lock icon + short label). */
export function GateMarker({ label, title }: { label: string; title: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={title}>
      <Lock className="size-2.5" aria-hidden />
      {label}
    </span>
  );
}
