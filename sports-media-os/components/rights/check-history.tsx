import { CircleCheck, CircleX, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ownershipLabel } from "@/lib/rights/schema";
import type { RightsCheckView } from "@/lib/rights/service";

import { RightsStatusBadge } from "./badges";
import { CheckedBy, ClassificationDetails, CommercialUseValue, EvidenceLink } from "./classification-details";

export function formatRightsTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Every classification of an asset, newest first, with the usage decisions
 * recorded on each. Only the latest one decides the asset's rights; older
 * ones stay as the audit trail.
 */
export function CheckHistory({ checks, timeZone }: { checks: RightsCheckView[]; timeZone: string }) {
  return (
    <ol className="grid gap-3" data-testid="check-history">
      {checks.map((c) => (
        <li
          key={c.id}
          className={c.isLatest ? "rounded-md border border-brand/40 px-3 py-2" : "rounded-md border px-3 py-2"}
          data-testid="history-check"
          data-status={c.status}
          data-latest={c.isLatest}
        >
          <div className="flex flex-wrap items-center gap-2">
            <RightsStatusBadge status={c.status} />
            {c.isLatest ? (
              <Badge variant="info">
                <History aria-hidden />
                Current
              </Badge>
            ) : (
              <Badge variant="outline">Superseded</Badge>
            )}
            <CheckedBy check={c} when={formatRightsTime(c.checkedAt, timeZone)} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{ownershipLabel(c.ownership)}</span>
            <CommercialUseValue value={c.commercialUse} />
            {c.evidenceUrl ? <EvidenceLink url={c.evidenceUrl} label="Evidence" /> : <span className="text-muted-foreground">No evidence link</span>}
          </p>

          {c.approvals.length ? (
            <ul className="mt-2 grid gap-1.5 border-l pl-3" aria-label="Usage decisions on this classification">
              {c.approvals.map((a, i) => (
                <li key={a.id} className="text-xs" data-testid="history-decision" data-decision={a.decision}>
                  <span className="inline-flex flex-wrap items-center gap-1.5 font-medium">
                    {a.decision === "approved" ? (
                      <CircleCheck className="size-3.5 text-success" aria-hidden />
                    ) : (
                      <CircleX className="size-3.5 text-danger" aria-hidden />
                    )}
                    {a.decision === "approved" ? "Use approved" : "Use rejected"}
                    {i === 0 && c.isLatest ? <span className="font-normal text-muted-foreground">(in effect)</span> : null}
                    <span className="font-normal text-muted-foreground">
                      {a.decidedBy ? `by ${a.decidedBy} · ` : ""}
                      {formatRightsTime(a.createdAt, timeZone)}
                    </span>
                  </span>
                  {a.notes ? <span className="block whitespace-pre-line text-muted-foreground">{a.notes}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">All fields</summary>
            <div className="mt-2">
              <ClassificationDetails check={c} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
