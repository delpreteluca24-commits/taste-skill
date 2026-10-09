import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban, CircleCheck } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { OpportunityStatusBadge } from "@/components/opportunities/badges";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { formatRelative } from "@/lib/dashboard/format";
import { getActiveProject } from "@/lib/projects/service";
import { listResearchOverview } from "@/lib/research/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Research" };

export default async function ResearchPage() {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const supabase = await createClient();
  const list = await listResearchOverview(supabase, project.id);
  if (list.error) throw new Error("Could not load research");
  const rows = list.data;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Research"
        description={`Research workspaces for ${project.name}: sources, claims, timeline, quotes, media, competitors and open questions per opportunity. A person verifies every critical claim.`}
      />

      <SectionCard
        title="Workspaces"
        description="One per opportunity, newest first (rejected and archived opportunities are hidden). Critical claims that are not confirmed block READY."
        count={rows.length}
        testId="research-list"
      >
        {rows.length === 0 ? (
          <EmptyState>
            No research yet. Every opportunity gets a workspace: create one from a radar trend (Trends → Create opportunity) or manually on
            the{" "}
            <Link href="/opportunities" className="underline underline-offset-2">
              Opportunities
            </Link>{" "}
            page.
          </EmptyState>
        ) : (
          <Table data-testid="research-table">
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sources</TableHead>
                <TableHead className="text-right">Claims confirmed</TableHead>
                <TableHead className="text-right">Critical not confirmed</TableHead>
                <TableHead className="text-right">Open questions</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="research-row">
                  <TableCell className="max-w-96 whitespace-normal">
                    <Link href={`/research/${r.id}`} className="line-clamp-2 text-[13px] font-medium hover:underline">
                      {r.title}
                    </Link>
                    {r.competition ? <p className="text-[11px] text-muted-foreground">{r.competition}</p> : null}
                  </TableCell>
                  <TableCell>
                    <OpportunityStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">{r.progress.sources}</TableCell>
                  <TableCell className="text-right text-xs tabular">
                    {r.progress.confirmedClaims} / {r.progress.claims}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular" data-testid="unconfirmed-critical">
                    {r.progress.unconfirmedCritical}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">{r.progress.openQuestions}</TableCell>
                  <TableCell>
                    {r.blockers > 0 ? (
                      <Badge variant="danger" title="Critical claims not confirmed: content cannot reach READY">
                        <Ban aria-hidden />
                        Blocks READY
                      </Badge>
                    ) : r.progress.claims > 0 ? (
                      <Badge variant="success" title="Every critical claim is confirmed">
                        <CircleCheck aria-hidden />
                        Critical facts confirmed
                      </Badge>
                    ) : (
                      <Badge variant="outline" title="No claims listed yet">
                        No claims yet
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular">{formatRelative(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
