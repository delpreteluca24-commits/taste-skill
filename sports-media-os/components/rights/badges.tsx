import { Ban, CircleCheck, Hourglass, ShieldAlert, ShieldCheck, ShieldQuestionMark, ShieldX, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Enums } from "@/lib/db/client";

/** Rights badges: always icon + label, never color alone. */

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info";

export const RIGHTS_STATUS_META: Record<
  Enums<"rights_status">,
  { label: string; icon: LucideIcon; variant: BadgeVariant; rule: string }
> = {
  green: { label: "GREEN", icon: ShieldCheck, variant: "success", rule: "May enter production under the recorded conditions." },
  yellow: {
    label: "YELLOW",
    icon: ShieldAlert,
    variant: "warning",
    rule: "Needs human review: usable only after a person approves it, never by automated workflows.",
  },
  red: { label: "RED", icon: ShieldX, variant: "danger", rule: "Never enters production." },
  unchecked: { label: "Unchecked", icon: ShieldQuestionMark, variant: "outline", rule: "Not classified yet: not usable in production." },
};

export function RightsStatusBadge({ status, className }: { status: Enums<"rights_status">; className?: string }) {
  const s = RIGHTS_STATUS_META[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} title={s.rule} className={className} data-testid="rights-status" data-status={status}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

/** Derived production usability (videos/sources.usable_in_production). */
export function UsableBadge({ usable, status }: { usable: boolean; status: Enums<"rights_status"> }) {
  if (usable) {
    const humansOnly = status === "yellow";
    return (
      <Badge
        variant="success"
        title={humansOnly ? "YELLOW approved by a person: usable in human-initiated production only" : "Cleared for production"}
        data-testid="usable"
        data-usable="true"
      >
        <CircleCheck aria-hidden />
        {humansOnly ? "Usable · humans only" : "Usable"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" title="Not cleared for production" data-testid="usable" data-usable="false">
      <Ban aria-hidden />
      Not usable
    </Badge>
  );
}

export function AwaitingApprovalBadge() {
  return (
    <Badge variant="warning" title="YELLOW: a person must approve or reject its use" data-testid="awaiting-approval">
      <Hourglass aria-hidden />
      Awaiting approval
    </Badge>
  );
}
