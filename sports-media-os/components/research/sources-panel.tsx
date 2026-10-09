import { Info } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize } from "@/lib/dashboard/format";
import { formatResearchDate } from "@/lib/research/format";
import { SOURCE_TYPE_LABELS } from "@/lib/research/schema";
import type { SourceOrigin, Workspace } from "@/lib/research/service";

import { AddSourceForm, RemoveSourceItemButton } from "./source-form";
import { AssetRights, SourceLink } from "./shared";

const ORIGIN_LABEL: Record<SourceOrigin, { label: string; title: string }> = {
  research: { label: "Research", title: "Added to this workspace as research material" },
  claim: { label: "Claim evidence", title: "Linked to at least one claim" },
  trend: { label: "Trend", title: "One of the sources of the trend behind this opportunity" },
};

export function SourcesPanel({ ws }: { ws: Workspace }) {
  // research items that hold a source in this workspace (removable as a unit)
  const itemBySource = new Map<string, { id: string; title: string }>();
  for (const item of [...ws.items.article, ...ws.items.video]) {
    if (item.sourceId && !itemBySource.has(item.sourceId)) itemBySource.set(item.sourceId, { id: item.id, title: item.title ?? "source" });
  }

  return (
    <div className="grid gap-4">
      <SectionCard
        title="Add a source"
        description="A link already in this project is reused with its rights classification; a new one starts as Unchecked."
        testId="add-source"
      >
        <AddSourceForm opportunityId={ws.opportunity.id} />
      </SectionCard>

      <SectionCard
        title="Sources in this workspace"
        description="Research material, claim evidence and the trend's own sources."
        count={ws.sources.length}
        testId="workspace-sources"
      >
        <p className="mb-3 flex items-start gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Rights belong to sources, never to the story. Citing a source as evidence is always allowed; using its material (footage,
            images, audio) in production needs GREEN, or YELLOW with a human rights approval. RED never enters production.
          </span>
        </p>
        {ws.sources.length === 0 ? (
          <EmptyState>
            No sources yet. Sources arrive with the trend behind an opportunity (from your connectors) or are added here by link.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>In this workspace</TableHead>
                <TableHead>Rights</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ws.sources.map((s) => {
                const item = itemBySource.get(s.id);
                return (
                  <TableRow key={s.id} data-testid="workspace-source">
                    <TableCell className="max-w-[28rem] min-w-56 whitespace-normal">
                      <SourceLink source={s} className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium hover:underline" />
                      <p className="text-[11px] text-muted-foreground">
                        {s.publishedAt ? `Published ${formatResearchDate(s.publishedAt)}` : "Publication date unknown"}
                      </p>
                      {s.summary ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{s.summary}</p> : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{SOURCE_TYPE_LABELS[s.sourceType]}</TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="flex flex-wrap gap-1">
                        {s.origins.map((o) => (
                          <Badge key={o} variant="secondary" title={ORIGIN_LABEL[o].title}>
                            {ORIGIN_LABEL[o].label}
                          </Badge>
                        ))}
                        {s.claimLinks ? (
                          <Badge variant="outline" title="Claims that link this source">
                            {s.claimLinks} claim{s.claimLinks === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                        {s.itemTypes
                          .filter((t) => t !== "article" && t !== "video")
                          .map((t) => (
                            <Badge key={t} variant="outline">
                              {humanize(t)}
                            </Badge>
                          ))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <AssetRights source={s} />
                    </TableCell>
                    <TableCell className="text-right">
                      {item ? <RemoveSourceItemButton itemId={item.id} title={item.title} /> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
