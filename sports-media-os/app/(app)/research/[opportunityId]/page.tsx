import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Target } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { ClaimsPanel } from "@/components/research/claims-panel";
import { CompetitorsPanel, MediaPanel, NotesPanel, QuestionsPanel, QuotesPanel, TimelinePanel } from "@/components/research/item-panels";
import { OverviewPanel } from "@/components/research/overview-panel";
import { sourceOptions } from "@/components/research/shared";
import { SourcesPanel } from "@/components/research/sources-panel";
import { WorkspaceNav } from "@/components/research/workspace-nav";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { formatRelative } from "@/lib/dashboard/format";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { parseTab, WORKSPACE_TABS } from "@/lib/research/schema";
import { loadWorkspace } from "@/lib/research/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Research workspace" };

export default async function ResearchWorkspacePage(props: PageProps<"/research/[opportunityId]">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const { opportunityId } = await props.params;
  if (!z.uuid().safeParse(opportunityId).success) notFound();
  const tab = parseTab((await props.searchParams).tab);

  const supabase = await createClient();
  const res = await loadWorkspace(supabase, project.id, opportunityId);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") notFound();
    throw new Error("Could not load the research workspace");
  }
  const ws = res.data;
  const p = ws.progress;
  const sources = sourceOptions(ws.sources);
  const tabLabel = WORKSPACE_TABS.find((t) => t.key === tab)?.label ?? "Overview";

  return (
    <div className="grid gap-4">
      <div>
        <Button asChild size="xs" variant="ghost" className="-ml-2 text-muted-foreground">
          <Link href="/research">
            <ArrowLeft />
            Research
          </Link>
        </Button>
      </div>
      <PageHeader
        title={ws.opportunity.title}
        description={[ws.opportunity.competition, `Research workspace · ${tabLabel}`, `opportunity created ${formatRelative(ws.opportunity.created_at)}`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <OpportunityStatusBadge status={ws.opportunity.status} />
            <Button asChild size="xs" variant="outline">
              <Link href={`/opportunities/${ws.opportunity.id}`}>
                <Target />
                Opportunity
              </Link>
            </Button>
          </>
        }
      />

      <WorkspaceNav
        opportunityId={ws.opportunity.id}
        active={tab}
        counts={{
          sources: p.sources,
          claims: p.claims,
          timeline: p.timeline,
          quotes: p.quotes,
          media: p.media,
          competitors: p.competitors,
          questions: p.openQuestions,
          notes: p.notes + p.context,
        }}
        alerts={{
          claims: p.unconfirmedCritical > 0 ? `${p.unconfirmedCritical} critical claim(s) not confirmed` : undefined,
          media: p.mediaNotCleared > 0 ? `${p.mediaNotCleared} media asset(s) not cleared for production` : undefined,
        }}
      />

      <section aria-label={tabLabel}>
        {tab === "overview" ? <OverviewPanel ws={ws} /> : null}
        {tab === "sources" ? <SourcesPanel ws={ws} /> : null}
        {tab === "claims" ? <ClaimsPanel ws={ws} sources={sources} /> : null}
        {tab === "timeline" ? <TimelinePanel ws={ws} sources={sources} /> : null}
        {tab === "quotes" ? <QuotesPanel ws={ws} sources={sources} /> : null}
        {tab === "media" ? <MediaPanel ws={ws} sources={sources} /> : null}
        {tab === "competitors" ? <CompetitorsPanel ws={ws} sources={sources} /> : null}
        {tab === "questions" ? <QuestionsPanel ws={ws} sources={sources} /> : null}
        {tab === "notes" ? <NotesPanel ws={ws} sources={sources} /> : null}
      </section>
    </div>
  );
}
