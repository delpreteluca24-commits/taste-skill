import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Link2, Radar } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { TrendDetailPanel } from "@/components/trends/trend-detail";
import { TrendFilters } from "@/components/trends/trend-filters";
import { TrendTable } from "@/components/trends/trend-table";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { getActiveProject, listSports } from "@/lib/projects/service";
import { canEdit, getMemberRole } from "@/lib/radar/service";
import { createClient } from "@/lib/supabase/server";
import { hasTrendFilters, parseTrendFilters, trendFilterParams } from "@/lib/trends/schema";
import { getTrendDetail, listTrends } from "@/lib/trends/service";

export const metadata: Metadata = { title: "Trends" };

export default async function TrendsPage(props: PageProps<"/trends">) {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const query = await props.searchParams;
  const filters = parseTrendFilters(query);
  const rawId = typeof query.id === "string" ? query.id : null;
  const selectedId = rawId && z.uuid().safeParse(rawId).success ? rawId : null;

  const supabase = await createClient();
  const [rows, sports, role, detail] = await Promise.all([
    listTrends(supabase, project.id, filters),
    listSports(),
    getMemberRole(supabase, project.id, user.id),
    selectedId ? getTrendDetail(supabase, project.id, selectedId) : Promise.resolve(null),
  ]);

  const baseParams = trendFilterParams(filters);
  const closeHref = baseParams.size ? `/trends?${baseParams.toString()}` : "/trends";
  const filtered = hasTrendFilters(filters);
  const showDetail = Boolean(detail);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Trends"
        description={`${project.name} · stories detected from your sources by the Trend Hunter: Source → Trend → Opportunity. Every score explains itself.`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/radar/connectors">
                <Link2 aria-hidden />
                Sources & connectors
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/radar">
                <Radar aria-hidden />
                Sports Radar
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard title="Filters">
        <TrendFilters filters={filters} sports={sports} />
      </SectionCard>

      {rawId && !detail ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          That trend was not found in this project.{" "}
          <Link href={closeHref} className="underline underline-offset-2">
            Back to the list
          </Link>
        </p>
      ) : null}

      <div className={showDetail ? "grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "grid gap-4"}>
        <SectionCard
          title="Trends by radar score"
          description="Radar score = 0.4 × interest + 0.4 × curiosity + 0.2 × room to stand out. Expired trends are hidden unless filtered."
          count={rows.length}
          testId="trend-list"
        >
          {rows.length === 0 ? (
            filtered ? (
              <EmptyState>
                No trend matches these filters.{" "}
                <Link href="/trends" className="underline underline-offset-2">
                  Reset filters
                </Link>
              </EmptyState>
            ) : (
              <EmptyState>
                No trends yet. They are detected from the sources your connectors collect (Sports Radar → Sources & connectors); detection
                runs after each fetch, or on demand with “Detect now” on the Sports Radar.
              </EmptyState>
            )
          ) : (
            <TrendTable rows={rows} selectedId={selectedId} baseParams={baseParams} compact={showDetail} />
          )}
        </SectionCard>

        {detail ? <TrendDetailPanel detail={detail} tz={project.timezone} canEdit={canEdit(role)} closeHref={closeHref} /> : null}
      </div>
    </div>
  );
}
