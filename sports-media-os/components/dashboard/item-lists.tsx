import { Badge } from "@/components/ui/badge";
import { formatCount, formatRelative, formatScore, humanize, platformLabel } from "@/lib/dashboard/format";
import { CONTENT_STAGE_ORDER } from "@/lib/content/stages";
import type { ContentRow, OpportunityRow, TrendRow } from "@/lib/dashboard/types";

import { EmptyState } from "./section-card";

function ScoreChip({ value, label }: { value: number | null; label: string }) {
  return (
    <span
      className="inline-flex h-6 min-w-9 items-center justify-center rounded-md border bg-secondary/50 px-1.5 text-xs font-semibold tabular"
      aria-label={`${label} ${formatScore(value)}`}
      title={label}
    >
      {formatScore(value)}
    </span>
  );
}

export function OpportunityList({ items, empty }: { items: OpportunityRow[]; empty: string }) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y">
      {items.map((o) => (
        <li key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <ScoreChip value={o.opportunity_score} label="Opportunity score" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">{o.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {[o.competition, humanize(o.status), formatRelative(o.created_at)].filter(Boolean).join(" · ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TrendList({ items }: { items: TrendRow[] }) {
  if (items.length === 0) {
    return <EmptyState>No active trends. Trends appear once source connectors run (Milestone 2).</EmptyState>;
  }
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <ScoreChip value={t.trend_score} label="Trend score" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">{t.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {humanize(t.status)} · seen {formatRelative(t.last_seen_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ContentList({
  items,
  empty,
  timeField,
}: {
  items: ContentRow[];
  empty: string;
  timeField: "stage_changed_at" | "scheduled_at" | "published_at";
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y">
      {items.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">{c.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {timeField === "scheduled_at" && !c.scheduled_at ? "Not scheduled" : formatRelative(c[timeField])}
              {c.target_platforms?.length ? ` · ${c.target_platforms.map(platformLabel).join(", ")}` : ""}
            </p>
          </div>
          <Badge variant="outline">{humanize(c.stage)}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function PipelineStrip({ pipeline }: { pipeline: Record<string, number> }) {
  const stages = CONTENT_STAGE_ORDER;
  return (
    <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-9" data-testid="pipeline">
      {stages.map((stage) => (
        <li key={stage} className="bg-card px-2.5 py-2">
          <p className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">{humanize(stage)}</p>
          <p className="text-lg font-semibold tabular">{formatCount(pipeline[stage] ?? 0)}</p>
        </li>
      ))}
    </ol>
  );
}
