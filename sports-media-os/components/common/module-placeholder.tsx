import Link from "next/link";
import { Construction } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { getModule, type ModuleKey } from "@/lib/navigation";

/**
 * Honest placeholder for modules scheduled in a later milestone.
 * No mock data: the page states what the module will do and when it lands.
 */
export function ModulePlaceholder({ module, capabilities }: { module: ModuleKey; capabilities: string[] }) {
  const m = getModule(module);
  return (
    <>
      <PageHeader title={m.label} description={m.description} />
      <div className="rounded-lg border border-dashed bg-card/40 p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary">
            <Construction className="size-4 text-warning" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">Scheduled for Milestone {m.milestone}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The database schema, permissions and guardrails for this module already exist. The workflow and UI ship
              in Milestone {m.milestone}.
            </p>
            <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
              {capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-brand">•</span>
                  {c}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/dashboard">Back to control room</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
