import Link from "next/link";

import { CompetitionBadge, MetricChip, RadarScore, SignalBadges, SweetSpotBadge, TrendStatusBadge } from "@/components/trends/badges";
import { CreateOpportunityButton } from "@/components/trends/create-opportunity-button";
import { formatRelative } from "@/lib/dashboard/format";
import type { RadarTrend } from "@/lib/radar/service";

/**
 * One radar story: radar score, interest / curiosity / competition chips,
 * signals, coverage, and the next editorial step (create or open the
 * opportunity). The title opens the full explanation on the Trends page.
 */
export function TrendCard({ trend: t, canEdit, dense }: { trend: RadarTrend; canEdit: boolean; dense?: boolean }) {
  return (
    <article className="grid content-between gap-2 rounded-md border bg-background/40 p-3" data-testid="radar-trend" data-trend-id={t.id}>
      <div className="grid gap-1.5">
        <div className="flex items-start gap-2.5">
          <RadarScore value={t.radar_score} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] leading-snug font-medium">
              <Link href={`/trends?id=${t.id}`} className="hover:underline">
                {t.title}
              </Link>
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t.sport?.name ? `${t.sport.name} · ` : ""}
              {t.source_count ?? 0} sources · {t.publisher_count ?? 0} publishers · seen {formatRelative(t.last_seen_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {t.is_sweet_spot ? <SweetSpotBadge /> : null}
          <TrendStatusBadge status={t.status} />
          <CompetitionBadge level={t.competition_level} />
        </div>
        {dense ? null : (
          <div className="flex flex-wrap gap-1">
            <MetricChip label="Interest" value={t.trend_score} />
            <MetricChip label="Curiosity" value={t.curiosity_score} />
          </div>
        )}
        <SignalBadges signals={t.signals} max={dense ? 3 : 5} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link href={`/trends?id=${t.id}`} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
          Why it ranks here
        </Link>
        <CreateOpportunityButton trendId={t.id} title={t.title} opportunity={t.opportunity} disabled={!canEdit} />
      </div>
    </article>
  );
}
