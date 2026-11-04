import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BookOpen, FileText, Microscope, Target } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import {
  FormatBadge,
  OpportunityScoreChip,
  ScriptStateBadge,
  StageAgeLabel,
  StageBadge,
  StoryStatusBadge,
} from "@/components/content/badges";
import { ApprovalsHistory, DetailNav, GatesPanel } from "@/components/content/detail-panels";
import { ContentEditForm, CreateStoryButton, StageMoveForm, StoryDecisionPanel } from "@/components/content/item-forms";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { EditorialAlternativesPanel } from "@/components/rights/editorial-alternatives";
import { HookStudio } from "@/components/scripts/hook-studio";
import { ScriptStudio } from "@/components/scripts/script-studio";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { scriptState, stageAge } from "@/lib/content/board";
import { DETAIL_TABS, parseDetailTab } from "@/lib/content/schema";
import { detail, type DecisionView } from "@/lib/content/service";
import { STAGE_LABELS, type ContentStage } from "@/lib/content/stages";
import { formatRelative, humanize } from "@/lib/dashboard/format";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Content item" };

export default async function ContentItemPage(props: PageProps<"/content/[id]">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab = parseDetailTab((await props.searchParams).tab);

  const supabase = await createClient();
  const [res, settings] = await Promise.all([detail(supabase, project.id, id), getWorkspaceSettings()]);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") notFound();
    throw new Error("Could not load the content item");
  }
  const { item, story, storyDecision, opportunity, currentScript, scriptCount, blockers, blockingFacts, blockingClips, approvals } = res.data;

  const stage = item.stage as ContentStage;
  const script = scriptState({
    storyId: story?.id ?? null,
    scriptId: currentScript?.id ?? null,
    scriptDecision: currentScript?.decision?.decision ?? null,
  });
  const age = stageAge(stage, item.stage_changed_at, new Date());
  const tz = project.timezone;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const display = (d: DecisionView | null) => (d ? { decision: d.decision, notes: d.notes, decidedBy: d.decidedBy, when: when(d.createdAt) } : null);
  const tabLabel = DETAIL_TABS.find((t) => t.key === tab)?.label ?? "Overview";

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <Button asChild size="xs" variant="ghost" className="-ml-2 text-muted-foreground">
          <Link href="/content">
            <ArrowLeft />
            Content
          </Link>
        </Button>
      </div>
      <PageHeader
        title={item.title}
        description={[`${STAGE_LABELS[stage]} · ${tabLabel}`, `created ${formatRelative(item.created_at)}`].join(" · ")}
        actions={
          <>
            <FormatBadge format={item.format} />
            <StageBadge stage={stage} />
          </>
        }
      />

      <DetailNav
        id={item.id}
        active={tab}
        alerts={{
          overview: blockers.length ? `${blockers.length} READY blocker(s)` : undefined,
          script: story && script !== "approved" ? "The current script is not approved yet" : undefined,
        }}
      />

      {tab === "script" || tab === "hooks" ? (
        <section aria-label={tabLabel}>
          {story ? (
            tab === "script" ? (
              <ScriptStudio storyId={story.id} />
            ) : (
              <HookStudio storyId={story.id} />
            )
          ) : (
            <NoStory contentItemId={item.id} what={tab === "script" ? "Scripts" : "Hooks"} />
          )}
        </section>
      ) : (
        <section aria-label="Overview" className="grid gap-4 lg:grid-cols-3">
          <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
            <SectionCard title="Stage" description="Same move as the board. The database checks the script and READY gates." testId="stage">
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StageBadge stage={stage} />
                  <StageAgeLabel age={age} />
                  {item.published_at ? (
                    <span className="text-[11px] text-muted-foreground">published {formatRelative(item.published_at)}</span>
                  ) : null}
                </div>
                <StageMoveForm id={item.id} stage={stage} />
              </div>
            </SectionCard>

            <SectionCard
              title="Gates & blockers"
              description="What the database will refuse, and why. READY blockers come from the READY gate itself."
              count={blockers.length}
              testId="blockers"
            >
              <GatesPanel script={script} blockers={blockers} facts={blockingFacts} clips={blockingClips} opportunityId={item.opportunity_id} />
            </SectionCard>

            <SectionCard title="Details" description="Title, format and description of this piece.">
              <ContentEditForm id={item.id} value={{ title: item.title, format: item.format, description: item.description }} />
            </SectionCard>

            {story ? (
              <SectionCard
                title="Production formats"
                description="STORY ≠ FOOTAGE: how this story is told when footage is missing or not cleared."
                testId="production-formats"
              >
                <EditorialAlternativesPanel storyId={story.id} />
              </SectionCard>
            ) : null}
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <SectionCard title="Story" description="STORY → APPROVAL. Approval never depends on footage." testId="story">
              {story ? (
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookOpen className="size-3.5 text-brand" aria-hidden />
                      <span className="min-w-0 flex-1 text-[13px] font-medium">{story.title}</span>
                      <StoryStatusBadge status={story.status} />
                    </div>
                    {story.logline ? <p className="text-xs whitespace-pre-line text-muted-foreground">{story.logline}</p> : null}
                    {story.angle ? (
                      <p className="text-xs">
                        <span className="text-muted-foreground">Angle: </span>
                        {story.angle}
                      </p>
                    ) : null}
                  </div>
                  <StoryDecisionPanel storyId={story.id} latest={display(storyDecision)} />
                </div>
              ) : (
                <div className="grid gap-3">
                  <EmptyState>
                    No story linked. Create one from this item&apos;s title and description; scripts, hooks and production formats hang off the
                    story.
                  </EmptyState>
                  <CreateStoryButton contentItemId={item.id} />
                </div>
              )}
            </SectionCard>

            <SectionCard title="Script" description="The production gate checks the story's CURRENT script." testId="script-summary">
              {story ? (
                <div className="grid gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <ScriptStateBadge state={script} />
                    {currentScript ? (
                      <span className="text-muted-foreground">
                        v{currentScript.version}
                        {currentScript.angle ? ` · ${humanize(currentScript.angle)}` : ""}
                        {currentScript.wordCount ? ` · ${currentScript.wordCount} words` : ""} · {scriptCount} version{scriptCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {currentScript?.decision ? (
                    <p className="text-muted-foreground">
                      {currentScript.decision.decision === "approved" ? "Approved" : "Rejected"}
                      {currentScript.decision.decidedBy ? ` by ${currentScript.decision.decidedBy}` : ""} · {when(currentScript.decision.createdAt)}
                    </p>
                  ) : null}
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link href={`/content/${item.id}?tab=script`}>
                      <FileText />
                      Open Script Studio
                    </Link>
                  </Button>
                </div>
              ) : (
                <EmptyState>Scripts belong to a story. Create the story first.</EmptyState>
              )}
            </SectionCard>

            <SectionCard title="Opportunity" testId="opportunity">
              {opportunity ? (
                <div className="grid gap-2 text-xs">
                  <div className="flex items-start gap-2">
                    <OpportunityScoreChip score={opportunity.opportunity_score} threshold={settings.thresholds.minOpportunityScore} />
                    <Link href={`/opportunities/${opportunity.id}`} className="min-w-0 flex-1 text-[13px] leading-snug hover:underline">
                      {opportunity.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <OpportunityStatusBadge status={opportunity.status} />
                    {opportunity.competition ? <span className="text-muted-foreground">{opportunity.competition}</span> : null}
                  </div>
                  {opportunity.why_now ? <p className="line-clamp-4 text-muted-foreground">{opportunity.why_now}</p> : null}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/opportunities/${opportunity.id}`}>
                        <Target />
                        Opportunity
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/research/${opportunity.id}`}>
                        <Microscope />
                        Research workspace
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState>
                  Not linked to an opportunity (created as an idea). Research workspaces and scores live on opportunities: create one on the
                  Opportunities page.
                </EmptyState>
              )}
            </SectionCard>

            <SectionCard title="Approvals history" description="Human decisions on this item, its story, scripts and opportunity." count={approvals.length}>
              <ApprovalsHistory entries={approvals.map((a) => ({ ...a, when: when(a.createdAt) }))} />
            </SectionCard>
          </div>
        </section>
      )}
    </div>
  );
}

function NoStory({ contentItemId, what }: { contentItemId: string; what: string }) {
  return (
    <div className="grid max-w-xl gap-3" data-testid="no-story">
      <EmptyState>{what} belong to a story, and this item has none yet. Create the story from the item; it can be approved even without usable footage.</EmptyState>
      <CreateStoryButton contentItemId={contentItemId} />
      <Link href={`/content/${contentItemId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        Back to overview
        <ArrowUpRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}
