import { Bot, CircleCheck, PenLine, Plus } from "lucide-react";
import { z } from "zod";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { HOOK_FACTOR_LABELS } from "@/lib/scoring/hook";
import { ANGLE_LABELS, HOOKS_PER_RUN } from "@/lib/scripts/schema";
import { getHookStudio, type HookView } from "@/lib/scripts/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { HookScoreBadge, HookTypeBadge } from "./badges";
import { GenerateHooksButton, ManualHookForm, SelectHookButton } from "./hook-controls";

/**
 * HOOK STUDIO for one story: hooks across six styles, each scored 0–100 with
 * a transparent breakdown (heuristic factors + the Hook agent's own score),
 * one selected by a person. Generation is a background job.
 */
export async function HookStudio({ storyId }: { storyId: string }) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) return <EmptyState>Select a project to open the Hook Studio.</EmptyState>;
  if (!z.uuid().safeParse(storyId).success) return <EmptyState>This story link is not valid.</EmptyState>;

  const db = await createClient();
  const res = await getHookStudio(db, project.id, storyId);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") return <EmptyState>Story not found in this project.</EmptyState>;
    throw new Error("Could not load the Hook Studio");
  }
  const { story, hooks, generateJob, factCount } = res.data;
  const selected = hooks.find((h) => h.isSelected) ?? null;

  return (
    <SectionCard
      title="Hook studio"
      description="Opening lines across six styles. Each score is explained factor by factor; clickbait and names or numbers not in the facts are penalised. A person picks the hook."
      count={hooks.length}
      testId="hook-studio"
    >
      <div className="grid gap-4">
        <GenerateHooksButton storyId={story.id} activeJobId={generateJob?.id ?? null} factCount={factCount} />

        {selected ? (
          <p className="flex items-start gap-1.5 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs" data-testid="selected-hook">
            <CircleCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium">Selected hook: </span>
              {selected.text}
            </span>
          </p>
        ) : hooks.length ? (
          <p className="text-xs text-muted-foreground">No hook selected yet. Pick the one the video opens with.</p>
        ) : null}

        {hooks.length ? (
          <ol className="grid gap-2" data-testid="hook-list">
            {hooks.map((h) => (
              <HookItem key={h.id} h={h} />
            ))}
          </ol>
        ) : (
          <EmptyState>
            No hooks yet. Generate {HOOKS_PER_RUN} with the Hook agent (from this story&apos;s research facts) or add your own below.
          </EmptyState>
        )}

        <details className="rounded-md border p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium select-none">
            <Plus className="size-3.5 text-brand" aria-hidden />
            Add a hook by hand
          </summary>
          <div className="mt-3">
            <ManualHookForm storyId={story.id} />
          </div>
        </details>
      </div>
    </SectionCard>
  );
}

function HookItem({ h }: { h: HookView }) {
  const e = h.explanation;
  return (
    <li
      className={cn("grid gap-2 rounded-md border p-3", h.isSelected && "border-success/40 bg-success/5")}
      data-testid="hook-item"
      data-selected={h.isSelected}
      data-hook-type={h.hookType}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <HookTypeBadge type={h.hookType} />
        <HookScoreBadge score={h.score} />
        {h.isSelected ? (
          <Badge variant="success">
            <CircleCheck aria-hidden />
            Selected
          </Badge>
        ) : null}
        {h.angle ? <Badge variant="outline">{ANGLE_LABELS[h.angle].label}</Badge> : null}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {h.origin === "ai" ? <Bot className="size-3" aria-hidden /> : <PenLine className="size-3" aria-hidden />}
          {h.origin === "ai" ? `Hook agent${h.model ? ` · ${h.model}` : ""}` : "Written by the team"}
        </span>
        <span className="ml-auto">
          <SelectHookButton hookId={h.id} selected={h.isSelected} />
        </span>
      </div>
      <p className="text-sm font-medium">{h.text}</p>
      {e ? (
        <details className="text-xs">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground select-none hover:bg-accent hover:text-foreground">
            Why {h.score ?? "—"}?
          </summary>
          <div className="mt-2 grid gap-2 rounded-md border border-dashed p-2.5" data-testid="hook-score-breakdown">
            <p className="text-muted-foreground">
              {e.method === "blend" && e.ai && e.blend
                ? `Score = ${Math.round(e.blend.heuristic * 100)}% heuristic (${e.heuristic.score}) + ${Math.round(e.blend.ai * 100)}% Hook agent (${e.ai.score}).`
                : `Heuristic score ${e.heuristic.score} (manual hooks are not scored by AI).`}
            </p>
            <table className="w-full text-left">
              <caption className="sr-only">Heuristic factors (start at {e.heuristic.base})</caption>
              <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Factor
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    Points
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-1 pr-2">Base</td>
                  <td className="py-1 pr-2 text-right tabular">{e.heuristic.base}</td>
                  <td className="py-1 text-muted-foreground">Every hook starts here.</td>
                </tr>
                {e.heuristic.factors.map((f, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap">{HOOK_FACTOR_LABELS[f.name]}</td>
                    <td className={cn("py-1 pr-2 text-right tabular", f.delta > 0 ? "text-success" : f.delta < 0 ? "text-danger" : "")}>
                      {f.delta > 0 ? `+${f.delta}` : f.delta}
                    </td>
                    <td className="py-1 text-muted-foreground">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {e.ai ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Hook agent: {e.ai.score}.</span> {e.ai.rationale ?? ""}
              </p>
            ) : null}
            {e.droppedFactIds > 0 ? (
              <p className="text-warning">The agent cited {e.droppedFactIds} fact reference(s) that were not in the research; they were removed.</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}
