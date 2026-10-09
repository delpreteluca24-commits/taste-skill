import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clapperboard, Eye, Gauge, Layers, Send, Target } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { AgentStatusList } from "@/components/dashboard/agent-status-list";
import { ContentList, OpportunityList, PipelineStrip, TrendList } from "@/components/dashboard/item-lists";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { ViewsChart } from "@/components/dashboard/views-chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { formatCount, formatScore } from "@/lib/dashboard/format";
import { getDashboard } from "@/lib/dashboard/service";
import { getActiveProject } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const d = await getDashboard(project.id);
  const m = d.metrics;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Control room"
        description={`${project.name} · ${d.timezone} · updated ${new Date(d.generated_at).toLocaleTimeString("en-GB", { timeZone: d.timezone, hour: "2-digit", minute: "2-digit" })}`}
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Views" value={formatCount(m.views)} hint="latest snapshot, all platforms" icon={Eye} />
        <StatTile label="Clips created" value={formatCount(m.clips_created)} hint="rendered clips" icon={Clapperboard} />
        <StatTile label="Content published" value={formatCount(m.content_published)} icon={Send} />
        <StatTile label="Top opportunity score" value={formatScore(m.top_opportunity_score)} hint="open opportunities" icon={Target} />
        <StatTile label="Avg virality score" value={formatScore(m.avg_virality_score)} hint="potential, not a prediction" icon={Gauge} />
        <StatTile label="Production queue" value={formatCount(m.production_queue)} hint="script · production · review" icon={Layers} />
      </section>

      <section aria-label="Pipeline">
        <PipelineStrip pipeline={d.pipeline} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Today's opportunities" count={d.todays_opportunities.length} testId="todays-opportunities">
          <OpportunityList
            items={d.todays_opportunities}
            empty="Nothing new today. The opportunity engine (Milestone 2) fills this from real sources."
          />
        </SectionCard>
        <SectionCard title="Top opportunities" count={d.top_opportunities.length} testId="top-opportunities">
          <OpportunityList items={d.top_opportunities} empty="No open opportunities yet." />
        </SectionCard>
        <SectionCard title="Trending stories" count={d.trending_stories.length} testId="trending-stories">
          <TrendList items={d.trending_stories} />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Content in production" count={d.content_in_production.length} testId="content-in-production">
          <ContentList items={d.content_in_production} timeField="stage_changed_at" empty="Production queue is empty." />
        </SectionCard>
        <SectionCard title="Ready to publish" count={d.ready_to_publish.length} testId="ready-to-publish">
          <ContentList
            items={d.ready_to_publish}
            timeField="scheduled_at"
            empty="Nothing ready. Content reaches READY only with confirmed critical facts and safe rights."
          />
        </SectionCard>
        <SectionCard title="Published" count={d.published.length} testId="published">
          <ContentList items={d.published} timeField="published_at" empty="Nothing published yet." />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Performing content" className="lg:col-span-3" testId="performing-content">
          {d.performing_content.length === 0 ? (
            <EmptyState>No analytics yet. Performance appears once published content has metrics.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Content</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Likes</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  <TableHead className="text-right">Predicted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.performing_content.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-64 truncate">{c.title}</TableCell>
                    <TableCell className="text-right tabular">{formatCount(c.views)}</TableCell>
                    <TableCell className="text-right tabular">{formatCount(c.likes)}</TableCell>
                    <TableCell className="text-right tabular">{formatCount(c.shares)}</TableCell>
                    <TableCell className="text-right tabular">{formatScore(c.predicted_score)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
        <SectionCard title="Views gained per day" description="Last 14 days" className="lg:col-span-2" testId="recent-performance">
          <ViewsChart days={d.recent_performance} />
        </SectionCard>
      </div>

      <SectionCard title="Agent status" description="Latest run per agent" testId="agent-status">
        <AgentStatusList runs={d.agent_status} />
      </SectionCard>
    </div>
  );
}
