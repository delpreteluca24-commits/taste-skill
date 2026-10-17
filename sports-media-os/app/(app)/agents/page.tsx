import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot, CircleDollarSign, Cpu, TriangleAlert } from "lucide-react";

import { AGENTS } from "@/agents/registry";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents" };

const STATUS_DOT: Record<string, string> = {
  completed: "bg-success",
  running: "bg-info animate-pulse",
  pending: "bg-muted-foreground",
  failed: "bg-danger",
  cancelled: "bg-muted-foreground",
};

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export default async function AgentsPage() {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const db = await createClient();
  const since = daysAgoIso(30);

  const [runs, usage, activity] = await Promise.all([
    db.from("agent_runs").select("agent, status, model, cost_usd, error_message, created_at").eq("project_id", project.id).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    db.rpc("ai_usage_summary", { p_project_id: project.id, p_days: 30 }),
    db.from("activity_logs").select("id, agent, action, status, created_at, error_message").eq("project_id", project.id).eq("actor_type", "agent").order("created_at", { ascending: false }).limit(15),
  ]);
  const runRows = runs.data ?? [];
  const usageRows = usage.data ?? [];
  const cost = usageRows.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0);
  const calls = usageRows.reduce((s, u) => s + Number(u.calls), 0);
  const failures = runRows.filter((r) => r.status === "failed").length;

  return (
    <div className="grid gap-5">
      <PageHeader eyebrow="Step 5 · Learn" title="Agents" description="Every AI agent, what it did in the last 30 days, what it cost and what failed. Agents prepare work; a person approves it." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Agent runs" value={String(runRows.length)} hint="last 30 days" icon={Bot} />
        <StatTile label="AI calls" value={String(calls)} hint="all models" icon={Cpu} />
        <StatTile label="AI cost" value={`$${cost.toFixed(2)}`} hint="last 30 days" icon={CircleDollarSign} />
        <StatTile label="Failures" value={String(failures)} hint="runs that failed" icon={TriangleAlert} />
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((a) => {
          const mine = runRows.filter((r) => r.agent === a.key);
          const last = mine[0];
          const spent = mine.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
          return (
            <div key={a.key} className="rounded-xl border bg-card/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-lg font-bold tracking-wide uppercase">{a.name}</p>
                <span className={cn("size-2.5 rounded-full", last ? STATUS_DOT[last.status] ?? "bg-muted-foreground" : "bg-border")} title={last?.status ?? "idle"} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.purpose}</p>
              <p className="mt-3 text-xs tabular text-muted-foreground">
                {mine.length} run(s) · ${spent.toFixed(2)}
                {last ? ` · last ${new Date(last.created_at).toLocaleDateString("en-GB")}` : " · idle"}
              </p>
              {last?.status === "failed" && last.error_message ? <p className="mt-1 line-clamp-2 text-xs text-danger">{last.error_message}</p> : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Cost by task and model" description="Last 30 days">
          {usageRows.length ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Task</TableHead><TableHead>Model</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Cost</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {usageRows.map((u) => (
                  <TableRow key={`${u.task}-${u.model}`}>
                    <TableCell>{u.task}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{u.model}</TableCell>
                    <TableCell className="text-right tabular">{u.calls}</TableCell>
                    <TableCell className="text-right tabular">{u.cost_usd === null ? "—" : `$${Number(u.cost_usd).toFixed(3)}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState>No AI calls yet.</EmptyState>
          )}
        </SectionCard>
        <SectionCard title="Recent agent activity">
          {(activity.data ?? []).length ? (
            <ul className="grid gap-2 text-sm">
              {(activity.data ?? []).map((l) => (
                <li key={l.id} className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", l.status === "failed" ? "bg-danger" : l.status === "warning" ? "bg-warning" : "bg-success")} />
                  <span className="flex-1"><span className="font-medium">{l.agent}</span> · {l.action}{l.error_message ? <span className="block text-xs text-danger">{l.error_message}</span> : null}</span>
                  <span className="text-xs text-muted-foreground tabular">{new Date(l.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No agent activity yet.</EmptyState>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
