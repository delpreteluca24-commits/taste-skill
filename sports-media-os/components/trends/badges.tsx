import {
  Archive,
  ArrowLeftRight,
  Bot,
  Calculator,
  CalendarClock,
  Crosshair,
  Flag,
  Gauge,
  HeartPulse,
  MessageSquareQuote,
  Mountain,
  Shuffle,
  Sigma,
  Sprout,
  Swords,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  UserPen,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatScore } from "@/lib/dashboard/format";
import type { Enums } from "@/lib/db/client";
import { SIGNAL_DESCRIPTIONS, SIGNAL_LABELS, type RadarSignal } from "@/lib/radar/signals";
import { cn } from "@/lib/utils";

/** Trend status, competition, metric and signal badges: always icon + label, never color alone. */

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

const STATUS: Record<Enums<"trend_status">, { label: string; icon: LucideIcon; variant: BadgeVariant; title: string }> = {
  emerging: { label: "Emerging", icon: Sprout, variant: "info", title: "Fewer than 3 sources so far" },
  rising: { label: "Rising", icon: TrendingUp, variant: "success", title: "More sources in the last 6h than in the previous 6h" },
  peaking: { label: "Peaking", icon: Mountain, variant: "warning", title: "Steady coverage" },
  declining: { label: "Declining", icon: TrendingDown, variant: "outline", title: "Coverage slowing down or no new source for 12h" },
  expired: { label: "Expired", icon: Archive, variant: "outline", title: "No new source for 72h" },
};

export function TrendStatusBadge({ status }: { status: Enums<"trend_status"> }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} title={s.title} data-testid="trend-status" data-status={status}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

const COMPETITION: Record<Enums<"competition_level">, { label: string; variant: BadgeVariant; title: string }> = {
  low: { label: "Low competition", variant: "success", title: "Few of the outlets you track cover it: room to stand out" },
  medium: { label: "Medium competition", variant: "warning", title: "Several outlets cover it" },
  high: { label: "High competition", variant: "danger", title: "Many outlets cover it: hard to stand out" },
};

export function CompetitionBadge({ level }: { level: Enums<"competition_level"> | null }) {
  if (!level) {
    return (
      <Badge variant="outline" title="Not computed yet">
        <Gauge aria-hidden />
        Competition —
      </Badge>
    );
  }
  const c = COMPETITION[level];
  return (
    <Badge variant={c.variant} title={c.title} data-testid="competition-level" data-level={level}>
      <Gauge aria-hidden />
      {c.label}
    </Badge>
  );
}

export function SweetSpotBadge() {
  return (
    <Badge variant="success" title="Interest ≥ 60, curiosity ≥ 60 and competition not high" data-testid="sweet-spot">
      <Crosshair aria-hidden />
      Sweet spot
    </Badge>
  );
}

const SIGNAL_ICONS: Record<RadarSignal, LucideIcon> = {
  upcoming_event: CalendarClock,
  just_finished: Flag,
  breaking: Zap,
  upset: Shuffle,
  record: Trophy,
  rivalry: Swords,
  controversy: TriangleAlert,
  statement: MessageSquareQuote,
  unusual_stat: Sigma,
  injury: HeartPulse,
  transfer: ArrowLeftRight,
  rising_trend: TrendingUp,
};

export function SignalBadge({ signal, terms }: { signal: RadarSignal; terms?: string[] }) {
  const Icon = SIGNAL_ICONS[signal];
  const title = terms?.length ? `${SIGNAL_DESCRIPTIONS[signal]} — matched: ${terms.join(", ")}` : SIGNAL_DESCRIPTIONS[signal];
  return (
    <Badge variant="secondary" title={title} data-signal={signal}>
      <Icon aria-hidden />
      {SIGNAL_LABELS[signal]}
    </Badge>
  );
}

export function SignalBadges({ signals, max = 4 }: { signals: readonly RadarSignal[]; max?: number }) {
  if (!signals.length) return <span className="text-[11px] text-muted-foreground">No signals</span>;
  const shown = signals.slice(0, max);
  const rest = signals.slice(max);
  return (
    <span className="flex flex-wrap gap-1" aria-label="Radar signals">
      {shown.map((s) => (
        <SignalBadge key={s} signal={s} />
      ))}
      {rest.length ? (
        <Badge variant="outline" title={rest.map((s) => SIGNAL_LABELS[s]).join(", ")}>
          +{rest.length}
        </Badge>
      ) : null}
    </span>
  );
}

const BAND = {
  high: "border-success/40 bg-success/10 text-success",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "bg-secondary/60 text-muted-foreground",
  none: "bg-secondary/40 text-muted-foreground",
} as const;

/** Labelled 0–100 metric ("Interest 72"); the band follows the sweet-spot threshold (60). */
export function MetricChip({ label, value, threshold = 60, title }: { label: string; value: number | null; threshold?: number; title?: string }) {
  const band = value === null ? "none" : value >= threshold ? "high" : value >= threshold - 20 ? "medium" : "low";
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px]", BAND[band])}
      title={title ?? `${label} ${formatScore(value)} of 100 (sweet spot needs ≥ ${threshold})`}
      data-metric={label.toLowerCase()}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular">{formatScore(value)}</span>
    </span>
  );
}

/** Radar score: the priority order of the board. */
export function RadarScore({ value, size = "sm" }: { value: number | null; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-brand/40 bg-brand/10 font-semibold text-brand tabular",
        size === "lg" ? "h-10 min-w-14 px-2 text-xl" : "h-6 min-w-10 px-1.5 text-xs",
      )}
      aria-label={`Radar score ${formatScore(value)} of 100`}
      title="Radar score = 0.4 × interest + 0.4 × curiosity + 0.2 × competition gap"
      data-testid="radar-score"
    >
      {formatScore(value)}
    </span>
  );
}

const ORIGIN = {
  heuristic: { label: "Auto title", icon: Calculator, variant: "outline" as const, title: "Built from the most shared names in the sources" },
  ai: { label: "AI title", icon: Bot, variant: "info" as const, title: "Written by the discovery model from the source headlines only, then checked: every name and number appears in them" },
  manual: { label: "Edited title", icon: UserPen, variant: "warning" as const, title: "Set by a person; detection never overwrites it" },
};

export function TitleOriginBadge({ origin }: { origin: unknown }) {
  const o = origin === "ai" || origin === "heuristic" ? ORIGIN[origin] : ORIGIN.manual;
  const Icon = o.icon;
  return (
    <Badge variant={o.variant} title={o.title}>
      <Icon aria-hidden />
      {o.label}
    </Badge>
  );
}
