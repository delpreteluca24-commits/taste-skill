import Link from "next/link";
import { ArrowUpRight, CircleCheck, CircleX, Film, LockKeyhole, LockKeyholeOpen, Scale } from "lucide-react";

import { EmptyState } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { explainBlocker, gateViews } from "@/lib/content/blockers";
import type { ScriptState } from "@/lib/content/board";
import { DETAIL_TABS, type DetailTab } from "@/lib/content/schema";
import type { ApprovalEntry, BlockingClip, BlockingFact } from "@/lib/content/service";
import { humanize } from "@/lib/dashboard/format";
import { FACT_STATUS_VIEW } from "@/lib/factcheck/presentation";
import { cn } from "@/lib/utils";

/** Item tabs as plain links (?tab=…): shareable, back-button friendly, no client JS. */
export function DetailNav({ id, active, alerts }: { id: string; active: DetailTab; alerts: Partial<Record<DetailTab, string>> }) {
  return (
    <nav aria-label="Content item sections" className="-mx-1 overflow-x-auto border-b" data-testid="content-tabs">
      <ul className="flex min-w-max gap-0.5 px-1">
        {DETAIL_TABS.map((t) => {
          const isActive = t.key === active;
          const alert = alerts[t.key];
          return (
            <li key={t.key}>
              <Link
                href={t.key === "overview" ? `/content/${id}` : `/content/${id}?tab=${t.key}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs whitespace-nowrap transition-colors",
                  isActive
                    ? "border-brand font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
                title={alert}
              >
                {t.label}
                {alert ? (
                  <span className="text-warning" aria-label={alert}>
                    !
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const SCOPE_LABEL: Record<BlockingFact["scope"], string> = { item: "This item", story: "Story", opportunity: "Opportunity" };

/**
 * The two DB gates and what currently closes them. The list is the READY gate's
 * own (rpc content_item_blockers); claims and clips behind it are shown so a
 * person knows exactly what to fix and where.
 */
export function GatesPanel({
  script,
  blockers,
  facts,
  clips,
  opportunityId,
}: {
  script: ScriptState;
  blockers: string[];
  facts: BlockingFact[];
  clips: BlockingClip[];
  opportunityId: string | null;
}) {
  const gates = gateViews({ script, blockers });
  return (
    <div className="grid gap-3" data-testid="gates">
      <ul className="grid gap-2 sm:grid-cols-2">
        {gates.map((g) => (
          <li
            key={g.key}
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              g.state === "open" ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
            )}
            data-testid={`gate-${g.key}`}
            data-state={g.state}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {g.state === "open" ? (
                <LockKeyholeOpen className="size-3.5 text-success" aria-hidden />
              ) : (
                <LockKeyhole className="size-3.5 text-warning" aria-hidden />
              )}
              {g.label}: {g.state === "open" ? "open" : "closed"}
            </p>
            <p className="mt-0.5 text-muted-foreground">{g.detail}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Guards: {g.appliesTo}</p>
          </li>
        ))}
      </ul>

      {blockers.length === 0 ? (
        <EmptyState>No READY blockers: every critical claim in scope is confirmed and no clip uses uncleared material.</EmptyState>
      ) : (
        <ul className="grid gap-2" data-testid="blockers-list">
          {blockers.map((text) => {
            const b = explainBlocker(text, { opportunityId });
            return (
              <li key={text} className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs" data-kind={b.kind}>
                <p className="flex items-start gap-1.5 font-medium text-danger">
                  {b.kind === "clips" ? <Film className="mt-px size-3.5 shrink-0" aria-hidden /> : <Scale className="mt-px size-3.5 shrink-0" aria-hidden />}
                  {b.title}
                </p>
                <p className="mt-1 text-muted-foreground">{b.explanation}</p>

                {b.kind === "facts" && facts.length ? (
                  <ul className="mt-2 grid gap-1">
                    {facts.map((f) => {
                      const view = FACT_STATUS_VIEW[f.status];
                      return (
                        <li key={f.id} className="flex flex-wrap items-start gap-1.5 rounded border bg-card px-2 py-1">
                          <Badge variant={view.variant} title={view.description}>
                            {view.label}
                          </Badge>
                          <span className="min-w-0 flex-1 text-foreground">{f.claim}</span>
                          <span className="text-[10px] text-muted-foreground">{SCOPE_LABEL[f.scope]}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {b.kind === "clips" && clips.length ? (
                  <ul className="mt-2 grid gap-1">
                    {clips.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-1.5 rounded border bg-card px-2 py-1">
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.title ?? "Untitled clip"}</span>
                        <Link href={`/rights/video/${c.videoId}`} className="inline-flex items-center gap-1 text-[11px] hover:underline">
                          {c.videoTitle ?? "Source video"} · rights {c.rightsStatus ? humanize(c.rightsStatus) : "unknown"}
                          <ArrowUpRight className="size-3" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {b.action ? (
                  <Link href={b.action.href} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2">
                    {b.action.label}
                    <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const CHECKPOINT_LABEL: Record<string, string> = {
  opportunity: "Opportunity approval",
  story: "Story approval",
  script: "Script approval",
  production: "Production approval",
  publishing: "Publishing approval",
  rights: "Rights approval",
};

/** Append-only record of the human decisions behind this item (newest first). */
export function ApprovalsHistory({ entries }: { entries: (ApprovalEntry & { when: string })[] }) {
  if (!entries.length) {
    return <EmptyState>No decisions yet. Opportunity, story and script approvals recorded by people appear here.</EmptyState>;
  }
  return (
    <ol className="grid gap-2" data-testid="approvals-history">
      {entries.map((a) => (
        <li key={a.id} className="grid gap-0.5 border-l-2 pl-2.5 text-xs" data-decision={a.decision}>
          <p className="flex flex-wrap items-center gap-1.5">
            {a.decision === "approved" ? (
              <CircleCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <CircleX className="size-3.5 text-danger" aria-hidden />
            )}
            <span className="font-medium">{a.decision === "approved" ? "Approved" : "Rejected"}</span>
            <span className="text-muted-foreground">{a.entityLabel}</span>
            <span className="text-[10px] text-muted-foreground">· {CHECKPOINT_LABEL[a.checkpoint] ?? humanize(a.checkpoint)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {a.decidedBy ? `${a.decidedBy} · ` : ""}
            {a.when}
          </p>
          {a.notes ? <p className="whitespace-pre-line text-muted-foreground">{a.notes}</p> : null}
        </li>
      ))}
    </ol>
  );
}
