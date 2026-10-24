import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { FileText, Layers, Microscope, PenLine, TriangleAlert } from "lucide-react";
import { z } from "zod";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { productionGuidance } from "@/lib/scripts/formats";
import { ANGLE_LABELS, SCRIPT_ANGLES } from "@/lib/scripts/schema";
import { getScriptStudio, type ScriptStudioData, type ScriptVersionView } from "@/lib/scripts/service";
import { createClient } from "@/lib/supabase/server";

import { AngleTabs, type AngleTab } from "./angle-tabs";
import { angleLabel, CurrentBadge, DecisionBadge, FactChips, OperationBadge, ScriptSectionsView, WarningsPanel } from "./badges";
import {
  GenerateAnglesForm,
  MakeCurrentButton,
  ManualVersionEditor,
  ScriptDecisionForm,
  TransformControls,
  type ScriptDecisionDisplay,
} from "./script-controls";

/**
 * SCRIPT STUDIO for one story: angles, immutable versions, operations and the
 * SCRIPT → APPROVAL checkpoint.
 *
 * - every AI action enqueues a background job (no model call in the request)
 * - every change is a NEW version; "Make current" only switches the pointer
 * - only the current version can be approved; production needs that approval
 * - grounding warnings and the facts each version cites are always visible
 */
export async function ScriptStudio({ storyId }: { storyId: string }) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) return <EmptyState>Select a project to open the Script Studio.</EmptyState>;
  if (!z.uuid().safeParse(storyId).success) return <EmptyState>This story link is not valid.</EmptyState>;

  const db = await createClient();
  const res = await getScriptStudio(db, project.id, storyId);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") return <EmptyState>Story not found in this project.</EmptyState>;
    throw new Error("Could not load the Script Studio");
  }
  const d = res.data;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: project.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="grid gap-4" data-testid="script-studio">
      <SectionCard
        title="Script studio"
        description="Scripts per editorial angle, written only from this story's research. Every change is a new, immutable version; a person approves the current one before production."
        count={d.versionCount}
      >
        <div className="grid gap-4">
          <MaterialSummary d={d} />
          <GenerateAnglesForm storyId={d.story.id} activeJobId={d.generateJob?.id ?? null} hasVersions={d.versionCount > 0} />
        </div>
      </SectionCard>

      <SectionCard
        title="Current script"
        description="The version production uses. Approve or reject it here; generating or editing never replaces an approval silently."
        testId="current-script"
      >
        {d.current ? (
          <CurrentVersion v={d.current} d={d} when={when} />
        ) : (
          <div className="grid gap-4">
            <EmptyState>
              No script yet. Generate angles above (the AI writes only from the research facts), or write version 1 by hand below.
            </EmptyState>
            <details className="rounded-md border p-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium select-none">
                <PenLine className="size-3.5 text-brand" aria-hidden />
                Write a script by hand
              </summary>
              <div className="mt-3">
                <ManualVersionEditor key="none" storyId={d.story.id} initial={null} tone={null} baseVersion={null} />
              </div>
            </details>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Angles & versions"
        description="Version history per angle, newest first. Open a version to read it, make it current, or rewrite it into a new version."
        testId="script-versions"
      >
        <VersionTabs d={d} when={when} />
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function MaterialSummary({ d }: { d: ScriptStudioData }) {
  const production = productionGuidance(d.story.productionFormats);
  const c = d.factCounts;
  const usable = c.total - c.false;
  return (
    <div className="grid gap-2" data-testid="script-material">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant={usable > 0 ? "secondary" : "warning"}>
          <FileText aria-hidden />
          {usable} research fact{usable === 1 ? "" : "s"}
        </Badge>
        <span className="text-muted-foreground">
          {c.confirmed} confirmed · {c.probable} probable · {c.uncertain} uncertain
          {c.false ? ` · ${c.false} false (never used)` : ""} · {d.quotes} saved quote{d.quotes === 1 ? "" : "s"}
        </span>
        {d.story.opportunityId ? (
          <Button asChild size="xs" variant="ghost" className="text-muted-foreground">
            <Link href={`/research/${d.story.opportunityId}`}>
              <Microscope />
              Research workspace
            </Link>
          </Button>
        ) : null}
      </div>
      {usable === 0 ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-xs" role="note">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            No research facts yet: a script would stay general and list what is missing. Add and verify claims in the Research workspace
            first — the AI never fills gaps from memory.
          </span>
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="production-formats" data-original-only={production.originalOnly}>
        <Layers className="mt-px size-3.5 shrink-0 text-brand" aria-hidden />
        <span>
          {!production.chosen
            ? "No production formats chosen yet: scripts assume original formats (voiceover over graphics, stats cards, timelines) and never refer to clips or replays."
            : production.originalOnly
              ? `Original formats only (${production.labels.join(", ")}): no third-party footage is planned, so scripts are written as narration over original visuals.`
              : `Formats: ${production.labels.join(", ")}. Footage still needs a cleared rights check per asset, so scripts work as narration on their own.`}
        </span>
      </p>
    </div>
  );
}

function authorLine(v: ScriptVersionView): string {
  if (v.operation === "manual") return `Written by ${v.createdBy ?? "a team member"}`;
  return `Story agent${v.model ? ` · ${v.model}` : ""}${v.createdBy ? ` · requested by ${v.createdBy}` : ""}`;
}

function MetaLine({ v }: { v: ScriptVersionView }) {
  const parts = [
    v.wordCount !== null ? `${v.wordCount} words` : null,
    v.targetDurationSec ? `≈ ${v.targetDurationSec}s voiceover` : null,
    v.tone ? `tone: ${v.tone}` : null,
    v.language ? `language: ${v.language}` : null,
  ].filter(Boolean);
  return parts.length ? <p className="text-[11px] text-muted-foreground tabular">{parts.join(" · ")}</p> : null;
}

function decisionDisplay(v: ScriptVersionView, when: (iso: string) => string): ScriptDecisionDisplay | null {
  return v.decision ? { decision: v.decision.decision, notes: v.decision.notes, decidedBy: v.decision.decidedBy, when: when(v.decision.at) } : null;
}

function CurrentVersion({ v, d, when }: { v: ScriptVersionView; d: ScriptStudioData; when: (iso: string) => string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" data-testid="current-version" data-version={v.version}>
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-sm font-semibold tabular">v{v.version}</span>
          <Badge variant="outline">{angleLabel(v.angle)}</Badge>
          <OperationBadge operation={v.operation} />
          <CurrentBadge />
          <DecisionBadge decision={v.decision?.decision ?? null} />
          <span className="text-muted-foreground">
            {authorLine(v)} · <time dateTime={v.createdAt}>{when(v.createdAt)}</time>
          </span>
        </div>
        <div className="rounded-md border border-info/30 bg-info/5 p-3">
          <ScriptSectionsView sections={v.sections} />
        </div>
        <MetaLine v={v} />
        <WarningsPanel warnings={v.warnings} />
        <div className="grid gap-1.5">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Facts used</p>
          <FactChips ids={v.factsUsed} facts={d.facts} />
        </div>
        <div className="grid gap-1.5 border-t pt-3">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Rewrite as a new version</p>
          <TransformControls scriptId={v.id} version={v.version} activeJobId={d.transformJobs[v.id]?.id ?? null} />
        </div>
        <details className="rounded-md border p-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium select-none">
            <PenLine className="size-3.5 text-brand" aria-hidden />
            Edit as a new version
          </summary>
          <div className="mt-3">
            <ManualVersionEditor key={v.id} storyId={d.story.id} initial={v.sections} tone={v.tone} baseVersion={v.version} />
          </div>
        </details>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Approval</p>
        <ScriptDecisionForm key={v.id} scriptId={v.id} version={v.version} latest={decisionDisplay(v, when)} warningCount={v.warnings.length} />
      </div>
    </div>
  );
}

function VersionTabs({ d, when }: { d: ScriptStudioData; when: (iso: string) => string }) {
  if (d.versionCount === 0) {
    return <EmptyState>Versions appear here per angle once a script is generated or written. Every rewrite adds a version; none is ever overwritten.</EmptyState>;
  }
  const keyOf = (angle: string | null) => angle ?? "manual";
  const tabs: AngleTab[] = SCRIPT_ANGLES.map((angle) => {
    const group = d.groups.find((g) => g.angle === angle);
    return { key: angle, label: ANGLE_LABELS[angle].label, count: group?.versions.length ?? 0, hasCurrent: d.current?.angle === angle };
  });
  const manual = d.groups.find((g) => g.angle === null);
  if (manual) tabs.push({ key: "manual", label: "No angle", count: manual.versions.length, hasCurrent: d.current !== null && d.current.angle === null });

  const panels: Record<string, ReactNode> = {};
  for (const t of tabs) {
    const group = d.groups.find((g) => keyOf(g.angle) === t.key);
    panels[t.key] = group ? (
      <ol className="grid gap-2" data-testid="version-list" data-angle={t.key}>
        {group.versions.map((v, i) => (
          <VersionItem key={v.id} v={v} open={i === 0} d={d} when={when} />
        ))}
      </ol>
    ) : (
      <EmptyState>
        No {t.label.toLowerCase()} version yet. Tick “{t.label}” above and generate; it is written from the same research facts.
      </EmptyState>
    );
  }
  const defaultKey = d.current ? keyOf(d.current.angle) : keyOf(d.groups[0]?.angle ?? null);

  return (
    <Suspense fallback={panels[defaultKey]}>
      <AngleTabs tabs={tabs} panels={panels} defaultKey={defaultKey} />
    </Suspense>
  );
}

function VersionItem({ v, open, d, when }: { v: ScriptVersionView; open: boolean; d: ScriptStudioData; when: (iso: string) => string }) {
  return (
    <li>
      <details
        open={open}
        className={v.isCurrent ? "rounded-md border border-info/40 p-3" : "rounded-md border p-3"}
        data-testid="script-version"
        data-version={v.version}
        data-current={v.isCurrent}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-xs select-none">
          <span className="font-semibold tabular">v{v.version}</span>
          <OperationBadge operation={v.operation} />
          {v.parentVersion ? <span className="text-muted-foreground">from v{v.parentVersion}</span> : null}
          {v.isCurrent ? <CurrentBadge /> : null}
          <DecisionBadge decision={v.decision?.decision ?? null} />
          {v.warnings.length ? (
            <Badge variant="warning">
              <TriangleAlert aria-hidden />
              {v.warnings.length} warning{v.warnings.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
          <span className="basis-full text-muted-foreground sm:ml-auto sm:basis-auto">
            {authorLine(v)} · <time dateTime={v.createdAt}>{when(v.createdAt)}</time>
          </span>
        </summary>
        <div className="mt-3 grid gap-3">
          <ScriptSectionsView sections={v.sections} />
          <MetaLine v={v} />
          <WarningsPanel warnings={v.warnings} />
          <FactChips ids={v.factsUsed} facts={d.facts} />
          {v.decision?.notes ? (
            <p className="text-xs text-muted-foreground">
              Decision note{v.decision.decidedBy ? ` (${v.decision.decidedBy})` : ""}: {v.decision.notes}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-3 border-t pt-3">
            {!v.isCurrent ? <MakeCurrentButton scriptId={v.id} version={v.version} /> : null}
            <TransformControls scriptId={v.id} version={v.version} activeJobId={d.transformJobs[v.id]?.id ?? null} />
          </div>
        </div>
      </details>
    </li>
  );
}
