import Link from "next/link";
import {
  Ban,
  BookOpen,
  CalendarClock,
  Film,
  Flag,
  Info,
  ListChecks,
  MessageCircleQuestion,
  Quote,
  Swords,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/dashboard/format";
import { formatUsd } from "@/lib/opportunities/ai-cost";
import { readSuggestRunSummary } from "@/lib/research/ai-suggest";
import type { GapSeverity } from "@/lib/research/progress";
import type { Workspace } from "@/lib/research/service";

import { SuggestResearchButton } from "./ai-actions";

const SEVERITY: Record<GapSeverity, { label: string; icon: LucideIcon; variant: "danger" | "warning" | "outline" }> = {
  blocker: { label: "Blocks READY", icon: Ban, variant: "danger" },
  warning: { label: "Gap", icon: TriangleAlert, variant: "warning" },
  info: { label: "Tip", icon: Info, variant: "outline" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function LastRun({ job }: { job: NonNullable<Workspace["researchJob"]> }) {
  if (job.status === "pending" || job.status === "running") return null;
  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Last run {formatRelative(job.finishedAt ?? job.createdAt)}: {job.status === "failed" ? "failed" : "cancelled"}
        {job.errorMessage ? ` — ${job.errorMessage.slice(0, 200)}` : ""}.
      </p>
    );
  }
  const s = readSuggestRunSummary(job.result);
  if (!s) return <p className="text-[11px] text-muted-foreground">Last run {formatRelative(job.finishedAt ?? job.createdAt)}.</p>;
  const added = [
    s.inserted.claims ? `${plural(s.inserted.claims, "claim")} (Uncertain)` : null,
    s.inserted.questions ? plural(s.inserted.questions, "question") : null,
    s.inserted.timeline ? plural(s.inserted.timeline, "timeline event") : null,
    s.inserted.context ? plural(s.inserted.context, "context note") : null,
  ].filter(Boolean);
  return (
    <div className="grid gap-1 text-[11px] text-muted-foreground" data-testid="ai-suggest-last-run">
      <p>
        Last run {formatRelative(job.finishedAt ?? job.createdAt)} on {s.model ?? "unknown model"} · cost {formatUsd(s.costUsd)} ·{" "}
        {added.length ? `added ${added.join(", ")}` : "nothing new to add"}.
      </p>
      {s.droppedUnsourced > 0 ? (
        <p className="flex items-start gap-1 text-warning">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {plural(s.droppedUnsourced, "suggestion")} dropped: no source from this workspace backed {s.droppedUnsourced === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </div>
  );
}

export function OverviewPanel({ ws }: { ws: Workspace }) {
  const p = ws.progress;
  const o = ws.opportunity;
  const activeJobId = ws.researchJob && (ws.researchJob.status === "pending" || ws.researchJob.status === "running") ? ws.researchJob.id : null;
  const tab = (key: string) => `/research/${o.id}?tab=${key}`;

  return (
    <div className="grid gap-4">
      <section aria-label="Research progress" className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="research-progress">
        <StatTile label="Sources" value={String(p.sources)} hint="research items, claim evidence, trend" icon={BookOpen} />
        <StatTile label="Claims confirmed" value={`${p.confirmedClaims} / ${p.claims}`} hint={`${p.unsourcedClaims} without a source`} icon={ListChecks} />
        <StatTile label="Critical not confirmed" value={String(p.unconfirmedCritical)} hint="each one blocks READY" icon={Flag} />
        <StatTile label="Open questions" value={String(p.openQuestions)} hint={`${p.answeredQuestions} answered`} icon={MessageCircleQuestion} />
        <StatTile label="Timeline events" value={String(p.timeline)} icon={CalendarClock} />
        <StatTile label="Quotes" value={String(p.quotes)} hint="attributed" icon={Quote} />
        <StatTile label="Media assets" value={String(p.media)} hint={`${p.mediaNotCleared} not cleared for production`} icon={Film} />
        <StatTile label="Competitor videos" value={String(p.competitors)} icon={Swords} />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          title="Gaps"
          description="What is still missing before scripting. READY blockers first."
          className="lg:col-span-3"
          count={ws.gaps.length}
          testId="research-gaps"
        >
          {ws.gaps.length === 0 ? (
            <EmptyState>No gaps: every critical claim is confirmed and the core material is on hand.</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {ws.gaps.map((g) => {
                const s = SEVERITY[g.severity];
                const Icon = s.icon;
                return (
                  <li key={g.key} className="flex flex-wrap items-start gap-2 text-xs" data-gap={g.key}>
                    <Badge variant={s.variant}>
                      <Icon aria-hidden />
                      {s.label}
                    </Badge>
                    <span className="min-w-0 flex-1">{g.message}</span>
                    <Link href={tab(g.tab)} className="text-[11px] whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                      Open {g.tab === "notes" ? "notes" : g.tab}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <SectionCard
            title="AI research assist"
            description="Suggests questions, claims, a timeline and context from this opportunity and its sources only. Claims arrive as Uncertain, linked as “Mentions”: the AI never confirms or approves."
            testId="ai-research-assist"
          >
            <div className="grid gap-2">
              <SuggestResearchButton opportunityId={o.id} activeJobId={activeJobId} sourceCount={p.sources} />
              {ws.researchJob ? <LastRun job={ws.researchJob} /> : null}
            </div>
          </SectionCard>

          <SectionCard title="Brief" description="From the opportunity. Edit it on the opportunity page.">
            <dl className="grid gap-2 text-xs">
              {(
                [
                  ["Why now", o.why_now],
                  ["Angle", o.angle],
                  ["Hook", o.hook],
                  ["Description", o.description],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
                  <dd className={value ? "whitespace-pre-line" : "text-muted-foreground"}>{value ?? "Not written yet."}</dd>
                </div>
              ))}
            </dl>
            <Link href={`/opportunities/${o.id}`} className="mt-3 inline-block text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Open the opportunity (score, approval)
            </Link>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
