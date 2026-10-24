import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, Clapperboard, ExternalLink, Microscope, TrendingUp } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { AIScoreButton } from "@/components/opportunities/ai-score-button";
import { ApprovalPanel, StartProductionButton, type DecisionView } from "@/components/opportunities/approval-panel";
import { OpportunityStatusBadge, ScoreChip, SignalBadges, SweetSpotBadge } from "@/components/opportunities/badges";
import { ComponentOverrideForm, OpportunityEditForm, RescoreButton } from "@/components/opportunities/opportunity-forms";
import { ScoreBreakdown } from "@/components/opportunities/score-breakdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { formatRelative, formatScore, humanize } from "@/lib/dashboard/format";
import { parseGuardError } from "@/lib/db/errors";
import { formatUsd } from "@/lib/opportunities/ai-cost";
import { notesFromExplanation } from "@/lib/opportunities/scoring";
import { getOpportunityDetail } from "@/lib/opportunities/service";
import { getActiveProject } from "@/lib/projects/service";
import { computeOpportunityScore, inputsFromRow, SCORE_COMPONENTS } from "@/lib/scoring/opportunity";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Opportunity" };

const IN_PRODUCTION = new Set(["production", "ready", "published"]);

type AIScoringMeta = {
  at?: string;
  model?: string;
  costUsd?: number | null;
  applied?: string[];
  keptManual?: string[];
  rejected?: { component: string; why: string }[];
};

export default async function OpportunityPage(props: PageProps<"/opportunities/[id]">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [detail, settings] = await Promise.all([getOpportunityDetail(supabase, project.id, id), getWorkspaceSettings()]);
  if (detail.error) {
    if (parseGuardError(detail.error)?.code === "NOT_FOUND") notFound();
    throw new Error("Could not load the opportunity");
  }
  const { opportunity: o, trend, event, sport, research, latestDecision, contentItems } = detail.data;

  const score = computeOpportunityScore(inputsFromRow(o));
  const notes = notesFromExplanation(o.score_explanation);
  const threshold = settings.thresholds.minOpportunityScore;
  const inProduction = IN_PRODUCTION.has(o.status);
  const aiMeta = ((o.metadata ?? {}) as { ai_scoring?: AIScoringMeta }).ai_scoring ?? null;
  const tz = project.timezone;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const decision: DecisionView | null = latestDecision
    ? {
        decision: latestDecision.decision,
        notes: latestDecision.notes,
        decidedBy: latestDecision.decidedBy,
        when: when(latestDecision.createdAt),
      }
    : null;

  return (
    <div className="grid gap-4">
      <div>
        <Button asChild size="xs" variant="ghost" className="-ml-2 text-muted-foreground">
          <Link href="/opportunities">
            <ArrowLeft />
            Opportunities
          </Link>
        </Button>
      </div>
      <PageHeader
        title={o.title}
        description={[sport?.name, o.competition, `created ${formatRelative(o.created_at)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {o.is_sweet_spot ? <SweetSpotBadge /> : null}
            <OpportunityStatusBadge status={o.status} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 lg:col-span-2">
          <SectionCard
            title="Opportunity score"
            description="Weighted 0–100 over nine components. Each number shows where it comes from: a documented heuristic, the AI scoring model, or a person."
            testId="opportunity-score"
          >
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <ScoreChip score={score.score} coverage={score.coverage} threshold={threshold} size="lg" />
                <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="score-summary">
                  {score.summary}
                  {score.score !== null ? ` Threshold ${threshold}: ${score.score >= threshold ? "at or above" : "below"}.` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <RescoreButton id={o.id} />
                <AIScoreButton ids={[o.id]} label="Refine with AI" />
              </div>
              {aiMeta?.at ? (
                <p className="text-[11px] text-muted-foreground" data-testid="ai-scoring-meta">
                  Last AI scoring {formatRelative(aiMeta.at)} on {aiMeta.model ?? "unknown model"} · cost {formatUsd(aiMeta.costUsd ?? null)}
                  {aiMeta.applied?.length ? ` · applied: ${aiMeta.applied.map(humanize).join(", ")}` : ""}
                  {aiMeta.keptManual?.length ? ` · kept manual: ${aiMeta.keptManual.map(humanize).join(", ")}` : ""}
                  {aiMeta.rejected?.length
                    ? ` · rejected: ${aiMeta.rejected.map((r) => `${humanize(r.component)} (${r.why})`).join(", ")}`
                    : ""}
                </p>
              ) : null}
              <ScoreBreakdown opportunityId={o.id} score={score} notes={notes} editable />
              <ComponentOverrideForm id={o.id} components={SCORE_COMPONENTS.map((c) => ({ key: c.key, label: c.label, weight: c.weight }))} />
            </div>
          </SectionCard>

          <SectionCard title="Editorial" description="Why now, angle and hook drive the story. Saving recomputes the heuristic components.">
            <OpportunityEditForm
              id={o.id}
              value={{ title: o.title, description: o.description, why_now: o.why_now, angle: o.angle, hook: o.hook, competition: o.competition }}
            />
          </SectionCard>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <SectionCard title="Approval" description="OPPORTUNITY → APPROVAL. A person decides; agents never approve." testId="approval">
            <div className="grid gap-4">
              <ApprovalPanel id={o.id} latest={decision} locked={inProduction} />
              {o.status === "approved" ? <StartProductionButton id={o.id} /> : null}
              {inProduction && contentItems.length ? (
                <ul className="grid gap-1.5">
                  {contentItems.map((c) => (
                    <li key={c.id}>
                      <Link href={`/content/${c.id}`} className="flex items-center gap-2 text-xs hover:underline">
                        <Clapperboard className="size-3.5 text-brand" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <Badge variant="outline">{humanize(c.stage)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Why now">
            <p className="text-xs whitespace-pre-line text-muted-foreground">{o.why_now ?? "Not written yet — add it in Editorial."}</p>
            {o.signals?.length ? (
              <div className="mt-2">
                <SignalBadges signals={o.signals} max={8} />
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Research" description="Material on hand feeds production feasibility.">
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Sources", research.sources],
                ["Confirmed facts", research.confirmedFacts],
                ["Timeline", research.timelineItems],
              ].map(([label, n]) => (
                <div key={label} className="rounded-md border px-2 py-1.5">
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
                  <dd className="text-base font-semibold tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <Button asChild size="sm" variant="outline" className="mt-3 w-full">
              <Link href={`/research/${o.id}`}>
                <Microscope />
                Open research workspace
              </Link>
            </Button>
          </SectionCard>

          {trend ? (
            <SectionCard title="Source trend">
              <Link href={`/trends?id=${trend.id}`} className="flex items-start gap-2 text-xs hover:underline">
                <TrendingUp className="mt-px size-3.5 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] text-foreground">{trend.title}</span>
                  <span className="text-muted-foreground">
                    {humanize(trend.status)} · trend {formatScore(trend.trend_score)} · seen {formatRelative(trend.last_seen_at)}
                  </span>
                </span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </SectionCard>
          ) : null}

          {event ? (
            <SectionCard title="Event">
              <p className="flex items-start gap-2 text-xs">
                <CalendarClock className="mt-px size-3.5 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px]">{event.title}</span>
                  <span className="text-muted-foreground">
                    {[event.competition, humanize(event.status), event.starts_at ? when(event.starts_at) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </p>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
