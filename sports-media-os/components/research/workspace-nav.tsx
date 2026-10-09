import Link from "next/link";

import { WORKSPACE_TABS, type WorkspaceTab } from "@/lib/research/schema";
import { cn } from "@/lib/utils";

/** Workspace tabs as plain links (?tab=…): shareable, back-button friendly, no client JS. */
export function WorkspaceNav({
  opportunityId,
  active,
  counts,
  alerts,
}: {
  opportunityId: string;
  active: WorkspaceTab;
  counts: Partial<Record<WorkspaceTab, number>>;
  /** tabs with something that needs attention (shown with a text marker, not color alone) */
  alerts: Partial<Record<WorkspaceTab, string>>;
}) {
  return (
    <nav aria-label="Research workspace sections" className="-mx-1 overflow-x-auto border-b" data-testid="research-tabs">
      <ul className="flex min-w-max gap-0.5 px-1">
        {WORKSPACE_TABS.map((t) => {
          const isActive = t.key === active;
          const count = counts[t.key];
          const alert = alerts[t.key];
          return (
            <li key={t.key}>
              <Link
                href={t.key === "overview" ? `/research/${opportunityId}` : `/research/${opportunityId}?tab=${t.key}`}
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
                {count !== undefined ? (
                  <span className="rounded border px-1 text-[10px] text-muted-foreground tabular">{count}</span>
                ) : null}
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
