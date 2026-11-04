import {
  Ban,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleX,
  Flag,
  Link2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/lib/db/client";
import type { EvidenceSummary } from "@/lib/factcheck/evidence";
import {
  CONFIDENCE_LABEL,
  confidenceBand,
  FACT_STATUS_VIEW,
  formatConfidence,
  RELATION_VIEW,
  type ClaimRelation,
  type FactStatus,
} from "@/lib/factcheck/presentation";
import { cn } from "@/lib/utils";

/** Research badges: always icon + label, never color alone. */

const STATUS_ICON: Record<FactStatus, LucideIcon> = {
  confirmed: CircleCheck,
  probable: CircleDot,
  uncertain: CircleHelp,
  false: CircleX,
};

export function FactStatusBadge({ status, prefix }: { status: FactStatus; prefix?: string }) {
  const v = FACT_STATUS_VIEW[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={v.variant} title={v.description} data-testid="fact-status" data-status={status}>
      <Icon aria-hidden />
      {prefix ? `${prefix} ` : ""}
      {v.label}
    </Badge>
  );
}

const RELATION_ICON: Record<ClaimRelation, LucideIcon> = { supports: ThumbsUp, contradicts: Ban, mentions: Link2 };

export function RelationBadge({ relation }: { relation: ClaimRelation }) {
  const v = RELATION_VIEW[relation];
  const Icon = RELATION_ICON[relation];
  return (
    <Badge variant={v.variant} title={v.description} data-relation={relation}>
      <Icon aria-hidden />
      {v.label}
    </Badge>
  );
}

export function CriticalBadge({ critical }: { critical: boolean }) {
  return critical ? (
    <Badge variant="warning" title="The story is wrong or misleading if this is false. Blocks READY until confirmed.">
      <Flag aria-hidden />
      Critical
    </Badge>
  ) : (
    <Badge variant="outline" title="Supporting detail: does not block READY">
      Not critical
    </Badge>
  );
}

export function AIBadge({ model, label = "AI suggestion" }: { model?: string | null; label?: string }) {
  return (
    <Badge variant="info" title={model ? `Suggested by an agent (${model}). Not verified.` : "Suggested by an agent. Not verified."}>
      <Bot aria-hidden />
      {label}
    </Badge>
  );
}

/** 0.86 → "86%" with its band in words for screen readers and tooltips. */
export function Confidence({ value, className }: { value: number | null; className?: string }) {
  const band = confidenceBand(value);
  return (
    <span className={cn("text-xs tabular", band === "none" && "text-muted-foreground", className)} title={CONFIDENCE_LABEL[band]}>
      {formatConfidence(value)}
      <span className="sr-only"> ({CONFIDENCE_LABEL[band]})</span>
    </span>
  );
}

const EVIDENCE_ICON: Record<EvidenceSummary["verdict"], { icon: LucideIcon; variant: "outline" | "success" | "warning" | "danger" }> = {
  unsourced: { icon: CircleDashed, variant: "outline" },
  mentioned_only: { icon: Link2, variant: "outline" },
  supported: { icon: ThumbsUp, variant: "success" },
  contested: { icon: TriangleAlert, variant: "warning" },
  contradicted: { icon: Ban, variant: "danger" },
};

export function EvidenceBadge({ evidence }: { evidence: EvidenceSummary }) {
  const v = EVIDENCE_ICON[evidence.verdict];
  const Icon = v.icon;
  return (
    <Badge
      variant={v.variant}
      title={`${evidence.supports} supporting · ${evidence.contradicts} contradicting · ${evidence.mentions} mentioning`}
      data-verdict={evidence.verdict}
    >
      <Icon aria-hidden />
      {evidence.label}
    </Badge>
  );
}

type RightsView = { label: string; icon: LucideIcon; variant: "success" | "warning" | "danger" | "outline"; title: string };

/**
 * Rights state of an ASSET (sources carry rights; stories never do).
 * YELLOW shows whether the human usage approval exists.
 */
export function rightsView(status: Enums<"rights_status">, usable: boolean): RightsView {
  switch (status) {
    case "green":
      return { label: "GREEN", icon: ShieldCheck, variant: "success", title: "Cleared: may enter production under the recorded conditions." };
    case "yellow":
      return usable
        ? { label: "YELLOW · approved", icon: ShieldAlert, variant: "warning", title: "Usable by people after a rights approval; never by automated workflows." }
        : { label: "YELLOW · needs approval", icon: ShieldAlert, variant: "warning", title: "Needs a human rights approval before any production use." };
    case "red":
      return { label: "RED", icon: ShieldX, variant: "danger", title: "Never enters production. Use original formats instead." };
    default:
      return { label: "Unchecked", icon: ShieldQuestion, variant: "outline", title: "No rights classification yet: not usable in production." };
  }
}

export function RightsBadge({ status, usable }: { status: Enums<"rights_status">; usable: boolean }) {
  const v = rightsView(status, usable);
  const Icon = v.icon;
  return (
    <Badge variant={v.variant} title={v.title} data-testid="rights-badge" data-rights={status}>
      <Icon aria-hidden />
      {v.label}
    </Badge>
  );
}
