import { Fragment } from "react";
import { Bot, Info, Settings2, TriangleAlert } from "lucide-react";

import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/dashboard/format";
import { describeChecker, FACT_STATUS_VIEW, RELATION_VIEW } from "@/lib/factcheck/presentation";
import { suggestionStaleReason } from "@/lib/factcheck/sanitize";
import type { ClaimView, Workspace } from "@/lib/research/service";

import { ApplySuggestionButton, AssessClaimButton } from "./ai-actions";
import { AIBadge, Confidence, CriticalBadge, EvidenceBadge, FactStatusBadge, RelationBadge } from "./badges";
import { ClaimStatusForm, EditClaimForm, LinkSourceForm, NewClaimForm, SetRelationButton, UnlinkSourceButton } from "./claim-forms";
import type { SourceOption } from "./item-forms";

function LinkedSources({ claim }: { claim: ClaimView }) {
  if (claim.links.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No linked source.</p>;
  }
  return (
    <ul className="grid gap-2">
      {claim.links.map((l) => {
        const label = l.source ? (l.source.title ?? l.source.name) : "Source";
        return (
          <li key={l.sourceId} className="grid gap-0.5" data-testid="claim-link" data-relation={l.relation}>
            <span className="flex flex-wrap items-center gap-1.5">
              <RelationBadge relation={l.relation} />
              {l.source ? (
                <a
                  href={l.source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="max-w-64 truncate text-xs hover:underline"
                  title={l.source.url}
                >
                  {label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Source not available</span>
              )}
              {l.locator ? <span className="text-[11px] text-muted-foreground">· {l.locator}</span> : null}
              <UnlinkSourceButton factId={claim.id} sourceId={l.sourceId} label={label} />
            </span>
            {l.excerpt ? (
              <blockquote className="line-clamp-3 border-l-2 pl-2 text-[11px] whitespace-normal text-muted-foreground">“{l.excerpt}”</blockquote>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Why "Apply suggestion" cannot run right now (null = it can). */
function applyBlocker(claim: ClaimView): string | null {
  const s = claim.aiSuggestion;
  if (!s) return "No suggestion yet.";
  const stale = suggestionStaleReason(s, { claim: claim.claim, sourceIds: claim.links.map((l) => l.sourceId) });
  if (stale) return `${stale} Ask the AI again.`;
  if (s.suggestedStatus === claim.status && s.confidence === claim.confidence) return "Already applied.";
  if (s.suggestedStatus === "confirmed" && claim.isCritical && !claim.evidence.canConfirm) {
    return "Mark a source as “Supports” first: a critical claim is confirmed only with a supporting source.";
  }
  return null;
}

function AISuggestionPanel({ claim }: { claim: ClaimView }) {
  const s = claim.aiSuggestion;
  const linked = new Map(claim.links.map((l) => [l.sourceId, l]));
  const blocker = applyBlocker(claim);
  return (
    <div className="grid gap-2 rounded-md border bg-secondary/20 p-3" data-testid="ai-suggestion">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Bot className="size-3.5 text-info" aria-hidden />
          AI fact-check assist
        </p>
        <AssessClaimButton
          factId={claim.id}
          activeJobId={claim.activeJobId}
          disabledReason={claim.links.length === 0 ? "Link a source first: the AI only reads linked sources." : null}
        />
      </div>
      {s ? (
        <div className="grid gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <FactStatusBadge status={s.suggestedStatus} prefix="Suggests" />
            <span className="text-[11px] text-muted-foreground">
              confidence <Confidence value={s.confidence} className="text-[11px]" />
            </span>
            <AIBadge model={s.model} label={s.model} />
            <span className="text-[11px] text-muted-foreground">{formatRelative(s.at)}</span>
          </div>
          <p className="whitespace-pre-line text-muted-foreground">{s.reasoning}</p>
          {s.adjustment ? (
            <p className="flex items-start gap-1 text-[11px] text-warning">
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              {s.adjustment}
            </p>
          ) : null}
          {s.droppedSourceIds > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Ignored {s.droppedSourceIds} source reference{s.droppedSourceIds === 1 ? "" : "s"} that {s.droppedSourceIds === 1 ? "was" : "were"} not linked to this claim.
            </p>
          ) : null}
          {s.sources.length ? (
            <ul className="grid gap-1.5">
              {s.sources.map((ss) => {
                const link = linked.get(ss.sourceId);
                const label = link?.source ? (link.source.title ?? link.source.name) : "Unlinked source";
                return (
                  <li key={ss.sourceId} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <RelationBadge relation={ss.relation} />
                    <span className="max-w-64 truncate">{label}</span>
                    {ss.note ? <span className="text-muted-foreground">— {ss.note}</span> : null}
                    {link && link.relation !== ss.relation ? (
                      <SetRelationButton factId={claim.id} sourceId={ss.sourceId} relation={ss.relation} sourceLabel={label} />
                    ) : link ? (
                      <span className="text-muted-foreground">(matches your link: {RELATION_VIEW[link.relation].label})</span>
                    ) : (
                      <span className="text-muted-foreground">(no longer linked)</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <ApplySuggestionButton factId={claim.id} disabledReason={blocker} />
            {blocker ? <span className="text-[11px] text-muted-foreground">{blocker}</span> : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            A suggestion never changes the claim by itself. Applying it records your verification ({FACT_STATUS_VIEW[s.suggestedStatus].label})
            through the same rules as a manual change.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No assessment yet. The fact-check model reads only this claim and its linked sources’ titles, summaries and excerpts, and suggests a
          status. You decide.
        </p>
      )}
    </div>
  );
}

function ClaimRow({ claim, opportunityId, sources }: { claim: ClaimView; opportunityId: string; sources: SourceOption[] }) {
  const checker = describeChecker(claim);
  return (
    <Fragment>
      <TableRow className="border-b-0 hover:bg-transparent" data-testid="claim-row" data-status={claim.status}>
        <TableCell className="max-w-[26rem] min-w-64 align-top whitespace-normal">
          <p className="text-[13px] font-medium">{claim.claim}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <CriticalBadge critical={claim.isCritical} />
            {claim.checkedByAgent === "researcher" && claim.status === "uncertain" ? <AIBadge label="Researcher agent" /> : null}
            <EditClaimForm factId={claim.id} claim={claim.claim} isCritical={claim.isCritical} />
          </div>
        </TableCell>
        <TableCell className="align-top">
          <FactStatusBadge status={claim.status} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {checker === "—" ? "Status not set by anyone yet" : `Status set by ${checker}`}
            {claim.checkedAt ? ` · ${formatRelative(claim.checkedAt)}` : ""}
          </p>
          {claim.notes ? <p className="mt-0.5 line-clamp-3 max-w-56 text-[11px] whitespace-normal text-muted-foreground">{claim.notes}</p> : null}
        </TableCell>
        <TableCell className="align-top">
          <Confidence value={claim.confidence} />
        </TableCell>
        <TableCell className="min-w-72 align-top whitespace-normal">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <EvidenceBadge evidence={claim.evidence} />
            {claim.evidence.hint ? <span className="text-[11px] text-muted-foreground">{claim.evidence.hint}</span> : null}
          </div>
          <LinkedSources claim={claim} />
        </TableCell>
      </TableRow>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={4} className="pt-0 pb-4 whitespace-normal">
          <div className="grid gap-3 xl:grid-cols-2">
            <details className="rounded-md border p-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium select-none">
                <Settings2 className="size-3.5 text-brand" aria-hidden />
                Verify: link sources and set the status
              </summary>
              <div className="mt-3 grid gap-4">
                <LinkSourceForm factId={claim.id} opportunityId={opportunityId} sources={sources} />
                <ClaimStatusForm
                  factId={claim.id}
                  status={claim.status}
                  confidence={claim.confidence}
                  notes={claim.notes}
                  isCritical={claim.isCritical}
                  canConfirm={claim.evidence.canConfirm}
                />
              </div>
            </details>
            <AISuggestionPanel claim={claim} />
          </div>
        </TableCell>
      </TableRow>
    </Fragment>
  );
}

export function ClaimsPanel({ ws, sources }: { ws: Workspace; sources: SourceOption[] }) {
  const p = ws.progress;
  return (
    <div className="grid gap-4">
      <SectionCard title="Add a claim" description="Every important statement the story relies on, so it can be checked against sources.">
        <NewClaimForm opportunityId={ws.opportunity.id} />
      </SectionCard>

      <SectionCard
        title="Fact check"
        description={`${p.confirmedClaims} of ${p.claims} confirmed · ${p.unconfirmedCritical} critical not confirmed (each blocks READY).`}
        count={ws.claims.length}
        testId="fact-check"
      >
        <p className="mb-3 flex items-start gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Only a person verifies. A critical claim can be Confirmed only with at least one source marked “Supports”; removing its last
            supporting source sends it back to Uncertain. AI-suggested claims arrive as Uncertain with their sources marked “Mentions”.
          </span>
        </p>
        {ws.claims.length === 0 ? (
          <EmptyState>
            No claims yet. Write down the facts the story depends on, or use “AI: suggest research” on the Overview tab to draft them from
            the workspace sources.
          </EmptyState>
        ) : (
          <Table data-testid="claims-table">
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ws.claims.map((c) => (
                <ClaimRow key={c.id} claim={c} opportunityId={ws.opportunity.id} sources={sources} />
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
