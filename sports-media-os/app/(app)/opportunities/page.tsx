import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Filter, Plus } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { JobStatus } from "@/components/jobs/job-status";
import { NewOpportunityForm } from "@/components/opportunities/opportunity-forms";
import { OpportunityTable, type OpportunityTableRow } from "@/components/opportunities/opportunity-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireUser } from "@/lib/auth/dal";
import { formatRelative, humanize } from "@/lib/dashboard/format";
import { hasFilters, OPPORTUNITY_STATUSES, parseOpportunityFilters, RADAR_SIGNALS } from "@/lib/opportunities/schema";
import { listActiveScoringJobs, listOpportunities } from "@/lib/opportunities/service";
import { getActiveProject, listSports } from "@/lib/projects/service";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage(props: PageProps<"/opportunities">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const filters = parseOpportunityFilters(await props.searchParams);
  const supabase = await createClient();
  const [list, sports, settings, jobs] = await Promise.all([
    listOpportunities(supabase, project.id, filters),
    listSports(),
    getWorkspaceSettings(),
    listActiveScoringJobs(supabase, project.id),
  ]);
  if (list.error) throw new Error("Could not load opportunities");

  const threshold = settings.thresholds.minOpportunityScore;
  const filtered = hasFilters(filters);
  const rows: OpportunityTableRow[] = list.data.map((o) => ({
    id: o.id,
    title: o.title,
    whyNow: o.why_now,
    status: o.status,
    score: o.opportunity_score,
    coverage: o.score_coverage,
    sport: o.sport?.name ?? null,
    competition: o.competition,
    signals: o.signals ?? [],
    sweetSpot: o.is_sweet_spot,
    createdLabel: formatRelative(o.created_at),
  }));

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Opportunities"
        description={`Scored content opportunities for ${project.name}. Every score explains itself; a person approves before production.`}
      />

      <details className="group rounded-lg border bg-card" data-testid="new-opportunity">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium select-none">
          <Plus className="size-4 text-brand transition-transform group-open:rotate-45" aria-hidden />
          New opportunity
          <span className="text-xs font-normal text-muted-foreground">
            — manual entry; opportunities from the radar are created on the Trends page
          </span>
        </summary>
        <div className="border-t px-4 py-4">
          <NewOpportunityForm sports={sports} />
        </div>
      </details>

      <SectionCard title="Filters">
        <Form action="/opportunities" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_auto]" data-testid="opportunity-filters">
          <div className="grid gap-1.5">
            <Label htmlFor="f-q">Search</Label>
            <Input id="f-q" name="q" type="search" placeholder="Title contains…" defaultValue={filters.search ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-status">Status</Label>
            <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Any</option>
              {OPPORTUNITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-sport">Sport</Label>
            <NativeSelect id="f-sport" name="sport" defaultValue={filters.sportId ?? ""}>
              <option value="">Any</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-signal">Signal</Label>
            <NativeSelect id="f-signal" name="signal" defaultValue={filters.signal ?? ""}>
              <option value="">Any</option>
              {RADAR_SIGNALS.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-min">Min score</Label>
            <Input id="f-min" name="min" type="number" min={0} max={100} step={1} placeholder={`e.g. ${threshold}`} defaultValue={filters.minScore ?? ""} />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex h-9 items-center gap-2 text-xs whitespace-nowrap">
              <input type="checkbox" name="sweet" value="1" defaultChecked={filters.sweetSpot} className="size-3.5 accent-brand" />
              Sweet spot only
            </label>
            <Button type="submit" size="sm" variant="secondary">
              <Filter />
              Apply
            </Button>
            {filtered ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/opportunities">Reset</Link>
              </Button>
            ) : null}
          </div>
        </Form>
      </SectionCard>

      {jobs.length ? (
        <SectionCard title="AI scoring in progress" description="Background jobs on the scoring model. The list refreshes when they finish.">
          <ul className="grid gap-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <JobStatus jobId={j.id} label={`AI scoring · ${j.count} opportunit${j.count === 1 ? "y" : "ies"}`} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Ranked opportunities"
        description={`Best score first. Threshold ${threshold} (Settings → Score thresholds). “Incomplete” = less than 70% of the model is scored.`}
        count={rows.length}
        testId="opportunity-list"
      >
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState>
              No opportunity matches these filters.{" "}
              <Link href="/opportunities" className="underline underline-offset-2">
                Reset filters
              </Link>
            </EmptyState>
          ) : (
            <EmptyState>
              No opportunities yet. They are created from radar trends (Trends → Create opportunity), which come from your
              connected sources, or manually with “New opportunity” above.
            </EmptyState>
          )
        ) : (
          <OpportunityTable rows={rows} threshold={threshold} />
        )}
      </SectionCard>
    </div>
  );
}
