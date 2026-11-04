import Link from "next/link";
import { CalendarClock, ExternalLink, X } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative, formatScore } from "@/lib/dashboard/format";
import { formatDateTime, formatVelocity } from "@/lib/radar/format";
import { EVENT_STATUS_LABELS } from "@/lib/radar/schema";
import { parseRadarExplanation } from "@/lib/trends/metrics";
import type { TrendDetail as Detail } from "@/lib/trends/service";

import { CompetitionBadge, MetricChip, RadarScore, SignalBadge, SweetSpotBadge, TitleOriginBadge, TrendStatusBadge } from "./badges";
import { CreateOpportunityButton } from "./create-opportunity-button";
import { RadarExplanation } from "./radar-explanation";

const RIGHTS_LABEL = { unchecked: "Rights unchecked", green: "GREEN", yellow: "YELLOW", red: "RED" } as const;
const RIGHTS_VARIANT = { unchecked: "outline", green: "success", yellow: "warning", red: "danger" } as const;

/**
 * Trend detail panel (/trends?id=…): what the story is, every source it was
 * built from (publisher, time, link, matched signal words), why it ranks where
 * it does, and the opportunities created from it.
 */
export function TrendDetailPanel({ detail, tz, canEdit, closeHref }: { detail: Detail; tz: string; canEdit: boolean; closeHref: string }) {
  const { trend: t, event, sources, opportunities } = detail;
  const explanation = parseRadarExplanation(t.radar_explanation);
  const meta = (t.metadata ?? {}) as { title_origin?: unknown; heuristic_title?: string; publishers?: string[] };
  const open = opportunities.find((o) => o.status !== "rejected" && o.status !== "archived") ?? null;

  return (
    <div className="grid gap-4" data-testid="trend-detail">
      <SectionCard title="Trend">
        <div className="grid gap-3">
          <div className="flex items-start gap-3">
            <RadarScore value={t.radar_score} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] leading-snug font-semibold">{t.title}</h2>
              {t.description ? <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p> : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <TrendStatusBadge status={t.status} />
                {t.is_sweet_spot ? <SweetSpotBadge /> : null}
                <CompetitionBadge level={t.competition_level} />
                <TitleOriginBadge origin={meta.title_origin} />
                {t.sport ? <Badge variant="outline">{t.sport.name}</Badge> : null}
              </div>
            </div>
            <Button asChild size="icon-sm" variant="ghost">
              <Link href={closeHref} aria-label="Close trend detail" scroll={false}>
                <X aria-hidden />
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            <MetricChip label="Interest" value={t.trend_score} />
            <MetricChip label="Curiosity" value={t.curiosity_score} />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Sources</dt>
              <dd className="tabular">{t.source_count ?? sources.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Publishers</dt>
              <dd className="tabular">{t.publisher_count ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Velocity</dt>
              <dd className="tabular" title="Change in sources per hour, last 6h vs previous 6h">
                {formatVelocity(t.velocity)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">First / last seen</dt>
              <dd className="tabular">
                {formatRelative(t.first_seen_at)} / {formatRelative(t.last_seen_at)}
              </dd>
            </div>
          </dl>

          {meta.title_origin === "ai" && meta.heuristic_title ? (
            <p className="text-[11px] text-muted-foreground">Auto title before AI labelling: “{meta.heuristic_title}”.</p>
          ) : null}

          {event ? (
            <p className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-medium">{event.title}</span>
              <span className="text-muted-foreground">
                · {EVENT_STATUS_LABELS[event.status]} · {formatDateTime(event.starts_at, tz)}
                {event.competition ? ` · ${event.competition}` : ""}
              </span>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {t.status === "expired" && !open ? (
              <p className="text-xs text-muted-foreground">Expired: no new source for 72h. It can still become an opportunity if the story is evergreen.</p>
            ) : null}
            <CreateOpportunityButton trendId={t.id} title={t.title} opportunity={open} disabled={!canEdit} size="sm" />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Why it is on the radar" description="Stored with the trend at detection time; every factor and its contribution.">
        <RadarExplanation explanation={explanation} />
      </SectionCard>

      <SectionCard
        title="Sources"
        description="Links and summaries only. Rights are classified per asset in the Rights Center before anything enters production."
        count={sources.length}
        testId="trend-sources"
      >
        {sources.length === 0 ? (
          <EmptyState>No sources linked. Sources are linked by the Trend Hunter from your connectors.</EmptyState>
        ) : (
          <ul className="divide-y">
            {sources.map((s) => (
              <li key={s.id} className="grid gap-1 py-2 first:pt-0 last:pb-0" data-testid="trend-source">
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="min-w-0 text-[13px] leading-snug hover:underline"
                  >
                    {s.title ?? s.url}
                    <ExternalLink className="ml-1 inline size-3 align-baseline text-muted-foreground" aria-hidden />
                    <span className="sr-only"> (opens the publisher&apos;s page in a new tab)</span>
                  </a>
                  <Badge variant={RIGHTS_VARIANT[s.rights_status]} title="Rights status of this source as an asset">
                    {RIGHTS_LABEL[s.rights_status]}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <span className="text-foreground">{s.publisher}</span>
                  {s.name.trim().toLowerCase() !== s.publisher ? ` · ${s.name}` : ""} ·{" "}
                  <time dateTime={s.published_at ?? s.retrieved_at} title={formatDateTime(s.published_at ?? s.retrieved_at, tz)}>
                    {s.published_at ? `published ${formatRelative(s.published_at)}` : `retrieved ${formatRelative(s.retrieved_at)}`}
                  </time>
                  {s.credibility !== null ? ` · credibility ${s.credibility}` : ""}
                </p>
                {s.matches.length ? (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Signals in this headline">
                    {s.matches.map((m) => (
                      <li key={m.signal} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <SignalBadge signal={m.signal} terms={m.terms} />
                        {m.terms.map((term) => `“${term}”`).join(", ")}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Opportunities from this trend" count={opportunities.length} testId="trend-opportunities">
        {opportunities.length === 0 ? (
          <EmptyState>None yet. “Create opportunity” scores this story with an explained heuristic; a person approves it before production.</EmptyState>
        ) : (
          <ul className="divide-y">
            {opportunities.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="w-10 text-right text-xs font-semibold tabular" title="Opportunity score">
                  {formatScore(o.opportunity_score)}
                </span>
                <Link href={`/opportunities/${o.id}`} className="min-w-0 flex-1 truncate text-[13px] hover:underline">
                  {o.title}
                </Link>
                <OpportunityStatusBadge status={o.status} />
                <span className="text-[11px] text-muted-foreground">{formatRelative(o.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
