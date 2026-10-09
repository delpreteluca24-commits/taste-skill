import type { ReactNode } from "react";
import { Bot, CircleCheck, CircleHelp, CircleX, ExternalLink, FileCheck } from "lucide-react";

import { commercialUseLabel, ownershipLabel } from "@/lib/rights/schema";
import type { RightsCheckView } from "@/lib/rights/service";

import { RightsStatusBadge } from "./badges";

/**
 * The ten rights-first fields of one classification, as a definition list.
 * Missing values render "Not recorded", never a guess.
 */

const NOT_RECORDED = <span className="text-muted-foreground">Not recorded</span>;

function Row({ term, children, wide }: { term: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "grid gap-0.5 sm:col-span-2" : "grid gap-0.5"}>
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{term}</dt>
      <dd className="min-w-0 text-xs break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

export function CommercialUseValue({ value }: { value: boolean | null }) {
  const Icon = value === true ? CircleCheck : value === false ? CircleX : CircleHelp;
  const tone = value === true ? "text-success" : value === false ? "text-danger" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={`size-3.5 ${tone}`} aria-hidden />
      {commercialUseLabel(value)}
    </span>
  );
}

export function EvidenceLink({ url, label = "Open evidence" }: { url: string | null; label?: string }) {
  if (!url) return NOT_RECORDED;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 hover:underline"
      title={url}
    >
      <FileCheck className="size-3.5 shrink-0 text-success" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Who recorded it: a person (DB-stamped) or, for automated suggestions, the agent. */
export function CheckedBy({ check, when }: { check: Pick<RightsCheckView, "checkedBy" | "checkedByAgent">; when: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      {check.checkedByAgent && !check.checkedBy ? (
        <>
          <Bot className="size-3" aria-hidden />
          Suggested by the {check.checkedByAgent} agent
        </>
      ) : (
        <>{check.checkedBy ? `Recorded by ${check.checkedBy}` : "Recorded by an automated process"}</>
      )}
      <span>· {when}</span>
    </span>
  );
}

export function ClassificationDetails({ check }: { check: RightsCheckView }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2" data-testid="classification-details">
      <Row term="Rights status">
        <RightsStatusBadge status={check.status} />
      </Row>
      <Row term="Ownership">
        {ownershipLabel(check.ownership)}
        {check.owner ? <span className="block text-muted-foreground">Rights holder: {check.owner}</span> : null}
      </Row>
      <Row term="Source">{check.sourceDetail ?? NOT_RECORDED}</Row>
      <Row term="License">{check.license ?? NOT_RECORDED}</Row>
      <Row term="Commercial use">
        <CommercialUseValue value={check.commercialUse} />
      </Row>
      <Row term="Transformation required">
        {check.transformationRequired ? "Yes: only transformed (commentary, edit, overlay)" : "No"}
      </Row>
      <Row term="Authorization" wide>
        {check.authorization ?? NOT_RECORDED}
      </Row>
      <Row term="Risk">{check.risk ?? NOT_RECORDED}</Row>
      <Row term="Evidence">
        <EvidenceLink url={check.evidenceUrl} />
      </Row>
      <Row term="Notes" wide>
        {check.notes ?? NOT_RECORDED}
      </Row>
    </dl>
  );
}
