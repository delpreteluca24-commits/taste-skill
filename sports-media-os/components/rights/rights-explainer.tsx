import { Clapperboard } from "lucide-react";

import { RIGHTS_STATUS_META, RightsStatusBadge } from "./badges";

const RULES = [
  {
    status: "green",
    detail:
      "Needs a documented basis: commercial use confirmed, a real ownership basis (owned, licensed, authorized, creator-provided, public domain) and an evidence link unless we own it. Automated workflows may use it.",
  },
  {
    status: "yellow",
    detail:
      "Plausible but not documented enough. A person approves or rejects its use on the latest classification. Even approved, workers and agents never use it.",
  },
  {
    status: "red",
    detail: "Third-party material without permission, denied commercial use, restricted licenses or known takedowns. It can't be approved.",
  },
] as const;

/** Short "How rights work" panel: the rules the database enforces, in plain words. */
export function RightsExplainer() {
  return (
    <div className="grid gap-3 text-xs" data-testid="rights-explainer">
      <ul className="grid gap-2.5">
        {RULES.map((r) => (
          <li key={r.status} className="grid gap-1">
            <span className="flex items-center gap-2">
              <RightsStatusBadge status={r.status} />
              <span className="font-medium">{RIGHTS_STATUS_META[r.status].rule}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">{r.detail}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-1 rounded-md border border-dashed px-3 py-2">
        <p className="flex items-center gap-1.5 font-medium">
          <Clapperboard className="size-3.5 text-brand" aria-hidden />
          Story ≠ footage
        </p>
        <p className="text-[11px] text-muted-foreground">
          Rights belong to assets (links and uploads), never to stories. A strong story stays approved when no footage is usable: produce it
          with original commentary, voiceover, statistics, graphics, timelines or maps. News articles used only as references don&apos;t need
          clearance; classify anything that would appear on screen.
        </p>
      </div>
    </div>
  );
}
