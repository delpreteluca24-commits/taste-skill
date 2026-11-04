import { CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { AGENTS } from "@/agents/registry";
import { formatRelative } from "@/lib/dashboard/format";
import type { AgentStatusRow } from "@/lib/dashboard/types";

const STATUS = {
  completed: { label: "OK", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "danger", icon: XCircle },
  running: { label: "Running", variant: "info", icon: Loader2 },
  pending: { label: "Queued", variant: "outline", icon: Clock },
  cancelled: { label: "Cancelled", variant: "outline", icon: XCircle },
  idle: { label: "Never run", variant: "outline", icon: CircleDashed },
} as const;

/** Every registered agent, merged with its latest run (status shown with icon + label, never color alone). */
export function AgentStatusList({ runs }: { runs: AgentStatusRow[] }) {
  const byAgent = new Map(runs.map((r) => [r.agent, r]));
  return (
    <ul className="grid gap-x-4 sm:grid-cols-2">
      {AGENTS.map((agent) => {
        const run = byAgent.get(agent.key);
        const status = STATUS[(run?.status as keyof typeof STATUS) ?? "idle"] ?? STATUS.idle;
        const Icon = status.icon;
        return (
          <li key={agent.key} className="flex items-center gap-2 border-b py-1.5 last:border-0 sm:[&:nth-last-child(2)]:border-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]" title={agent.purpose}>
                {agent.name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {run ? `last run ${formatRelative(run.finished_at ?? run.started_at ?? run.created_at)}` : "no runs yet"}
                {run && run.failures_24h > 0 ? ` · ${run.failures_24h} failed (24h)` : ""}
              </p>
            </div>
            <Badge variant={status.variant}>
              <Icon className={status === STATUS.running ? "animate-spin" : undefined} />
              {status.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
