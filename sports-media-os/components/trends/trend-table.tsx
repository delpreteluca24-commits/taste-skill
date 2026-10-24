import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/dashboard/format";
import { formatVelocity } from "@/lib/radar/format";
import type { TrendListRow } from "@/lib/trends/service";
import { cn } from "@/lib/utils";

import { CompetitionBadge, MetricChip, RadarScore, SignalBadges, SweetSpotBadge, TrendStatusBadge } from "./badges";

/**
 * Trends ranked by radar score. Each title opens the detail panel (?id=…)
 * while keeping the current filters in the URL.
 */
export function TrendTable({ rows, selectedId, baseParams, compact }: { rows: TrendListRow[]; selectedId?: string | null; baseParams: URLSearchParams; compact?: boolean }) {
  const hrefFor = (id: string) => {
    const p = new URLSearchParams(baseParams);
    p.set("id", id);
    return `/trends?${p.toString()}`;
  };
  return (
    <Table data-testid="trend-table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">Radar</TableHead>
          <TableHead>Trend</TableHead>
          {compact ? null : <TableHead>Scores</TableHead>}
          {compact ? null : <TableHead>Coverage</TableHead>}
          <TableHead className="text-right">Last seen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => {
          const selected = t.id === selectedId;
          return (
            <TableRow key={t.id} data-testid="trend-row" data-selected={selected} className={cn(selected && "bg-accent/60")}>
              <TableCell className="align-top">
                <RadarScore value={t.radar_score} />
              </TableCell>
              <TableCell className="max-w-96 align-top whitespace-normal">
                <Link
                  href={hrefFor(t.id)}
                  className="block text-[13px] font-medium hover:underline"
                  aria-current={selected ? "true" : undefined}
                  scroll={false}
                >
                  {t.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <TrendStatusBadge status={t.status} />
                  {t.is_sweet_spot ? <SweetSpotBadge /> : null}
                  {compact ? <CompetitionBadge level={t.competition_level} /> : null}
                  {t.sport ? <span className="text-[11px] text-muted-foreground">{t.sport.name}</span> : null}
                </div>
                <div className="mt-1">
                  <SignalBadges signals={t.signals} max={compact ? 3 : 4} />
                </div>
              </TableCell>
              {compact ? null : (
                <TableCell className="align-top">
                  <div className="flex flex-wrap gap-1">
                    <MetricChip label="Interest" value={t.trend_score} />
                    <MetricChip label="Curiosity" value={t.curiosity_score} />
                  </div>
                  <div className="mt-1">
                    <CompetitionBadge level={t.competition_level} />
                  </div>
                </TableCell>
              )}
              {compact ? null : (
                <TableCell className="align-top text-xs text-muted-foreground tabular">
                  <div>
                    {t.source_count ?? 0} sources · {t.publisher_count ?? 0} publishers
                  </div>
                  <div title="Change in sources per hour, last 6h vs previous 6h">velocity {formatVelocity(t.velocity)}</div>
                </TableCell>
              )}
              <TableCell className="text-right align-top text-xs text-muted-foreground tabular">{formatRelative(t.last_seen_at)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
