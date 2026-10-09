import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { KanbanBoard } from "@/components/content/kanban-board";
import { NewIdeaForm } from "@/components/content/item-forms";
import { EmptyState } from "@/components/dashboard/section-card";
import { requireUser } from "@/lib/auth/dal";
import { BOARD_LIMIT, board } from "@/lib/content/service";
import { getActiveProject } from "@/lib/projects/service";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Content" };

export default async function ContentPage() {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const supabase = await createClient();
  const [res, settings] = await Promise.all([board(supabase, project.id), getWorkspaceSettings()]);
  if (res.error) throw new Error("Could not load the content board");
  const { items, truncated, generatedAt } = res.data;

  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader
        title="Content"
        description={`Production pipeline for ${project.name}. Drag cards between stages or use “Move to…”. The database enforces the gates: PRODUCTION needs an approved script, READY needs confirmed critical claims and cleared clips. Moving a card never publishes anything.`}
      />

      <details className="group rounded-lg border bg-card" data-testid="new-idea">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium select-none">
          <Plus className="size-4 text-brand transition-transform group-open:rotate-45" aria-hidden />
          New idea
          <span className="text-xs font-normal text-muted-foreground">— lands at the top of IDEA; approved opportunities arrive in RESEARCH</span>
        </summary>
        <div className="border-t px-4 py-4">
          <NewIdeaForm />
        </div>
      </details>

      {items.length === 0 ? (
        <EmptyState>
          No content yet. Items arrive when you start production on an approved opportunity (Opportunities → Start production), or add an idea
          above.
        </EmptyState>
      ) : null}
      {truncated ? (
        <p className="text-xs text-warning" role="status">
          Showing the first {BOARD_LIMIT} items of this project.
        </p>
      ) : null}

      <KanbanBoard items={items} generatedAt={generatedAt} threshold={settings.thresholds.minOpportunityScore} />
    </div>
  );
}
