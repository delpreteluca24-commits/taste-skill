import {
  Archive,
  Bot,
  Calculator,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clapperboard,
  Crosshair,
  PackageCheck,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
  UserPen,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatScore, humanize, scoreBand } from "@/lib/dashboard/format";
import type { Enums } from "@/lib/db/client";
import { MIN_COVERAGE, type ComponentOrigin } from "@/lib/scoring/opportunity";
import { cn } from "@/lib/utils";

/** Status, score, origin and signal badges: always icon + label, never color alone. */

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

const STATUS: Record<Enums<"opportunity_status">, { label: string; icon: LucideIcon; variant: BadgeVariant }> = {
  new: { label: "New", icon: Sparkles, variant: "info" },
  researching: { label: "Researching", icon: Search, variant: "secondary" },
  approved: { label: "Approved", icon: CircleCheck, variant: "success" },
  rejected: { label: "Rejected", icon: CircleX, variant: "danger" },
  production: { label: "In production", icon: Clapperboard, variant: "info" },
  ready: { label: "Ready", icon: PackageCheck, variant: "success" },
  published: { label: "Published", icon: Send, variant: "success" },
  archived: { label: "Archived", icon: Archive, variant: "outline" },
};

export function OpportunityStatusBadge({ status }: { status: Enums<"opportunity_status"> }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} data-testid="opportunity-status" data-status={status}>
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

const BAND_LABEL = { high: "at or above threshold", medium: "close to threshold", low: "below threshold", none: "not scored" } as const;

/** Score chip with coverage; flags incomplete scores (coverage below MIN_COVERAGE). */
export function ScoreChip({
  score,
  coverage,
  threshold = 70,
  size = "sm",
}: {
  score: number | null;
  coverage: number | null;
  threshold?: number;
  size?: "sm" | "lg";
}) {
  const band = scoreBand(score, threshold);
  const incomplete = score !== null && (coverage ?? 0) < MIN_COVERAGE;
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="score-chip">
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border font-semibold tabular",
          size === "lg" ? "h-10 min-w-14 px-2 text-xl" : "h-6 min-w-10 px-1.5 text-xs",
          BAND_CLASS[band],
        )}
        aria-label={`Opportunity score ${formatScore(score)} of 100, ${BAND_LABEL[band]} (threshold ${threshold})`}
        title={`${BAND_LABEL[band]} (threshold ${threshold})`}
      >
        {formatScore(score)}
      </span>
      {score !== null ? (
        <span className="text-[11px] text-muted-foreground tabular" title="Share of the score model that has a value">
          {formatScore(coverage)}% known
        </span>
      ) : null}
      {incomplete ? (
        <span className="inline-flex items-center gap-0.5 text-[11px] text-warning" title={`Less than ${MIN_COVERAGE}% of the model is scored`}>
          <TriangleAlert className="size-3" aria-hidden />
          Incomplete
        </span>
      ) : null}
    </span>
  );
}

const ORIGIN: Record<ComponentOrigin, { label: string; icon: LucideIcon; variant: BadgeVariant; title: string }> = {
  heuristic: { label: "Heuristic", icon: Calculator, variant: "outline", title: "Computed from stored data by a documented rule" },
  ai: { label: "AI", icon: Bot, variant: "info", title: "Suggested by the scoring model from the opportunity fields and source titles" },
  manual: { label: "Manual", icon: UserPen, variant: "warning", title: "Set by a person; never overwritten by heuristics or AI" },
};

export function OriginBadge({ origin }: { origin: ComponentOrigin | null }) {
  if (!origin) {
    return (
      <Badge variant="outline" title="No value yet">
        <CircleDashed aria-hidden />
        Not scored
      </Badge>
    );
  }
  const o = ORIGIN[origin];
  const Icon = o.icon;
  return (
    <Badge variant={o.variant} title={o.title} data-origin={origin}>
      <Icon aria-hidden />
      {o.label}
    </Badge>
  );
}

export function SignalBadges({ signals, max = 3 }: { signals: string[]; max?: number }) {
  if (!signals.length) return <span className="text-[11px] text-muted-foreground">—</span>;
  const shown = signals.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <Badge key={s} variant="secondary">
          {humanize(s)}
        </Badge>
      ))}
      {signals.length > max ? (
        <Badge variant="outline" title={signals.slice(max).map(humanize).join(", ")}>
          +{signals.length - max}
        </Badge>
      ) : null}
    </span>
  );
}

export function SweetSpotBadge() {
  return (
    <Badge variant="success" title="Radar sweet spot: strong interest, room to stand out">
      <Crosshair aria-hidden />
      Sweet spot
    </Badge>
  );
}
