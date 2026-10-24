import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Link2, Plus, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { ConnectorActions } from "@/components/connectors/connector-actions";
import { ConnectorForm, EMPTY_CONNECTOR, type ConnectorFormValues } from "@/components/connectors/connector-form";
import { EnabledBadge, FetchStatusBadge, formatInterval } from "@/components/connectors/connector-status";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { ALL_MAPPING_FIELDS, KIND_LABELS } from "@/lib/connectors/schema";
import { listActiveFetchJobs, listConnectors } from "@/lib/connectors/service";
import type { ConnectorRow } from "@/lib/connectors/types";
import { formatRelative } from "@/lib/dashboard/format";
import { getActiveProject, listSports } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Source connectors" };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function toFormValues(c: ConnectorRow): ConnectorFormValues {
  const config = (c.config && typeof c.config === "object" && !Array.isArray(c.config) ? c.config : {}) as Record<string, unknown>;
  const mapping = Object.fromEntries(
    ALL_MAPPING_FIELDS.filter((f) => typeof config[f] === "string").map((f) => [f, config[f] as string]),
  );
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    url: c.url,
    target: c.target === "events" ? "events" : "sources",
    sportId: c.sport_id,
    credibility: c.credibility,
    defaultLicense: c.default_license,
    fetchIntervalMinutes: c.fetch_interval_minutes,
    enabled: c.enabled,
    mapping,
  };
}

export default async function ConnectorsPage(props: PageProps<"/radar/connectors">) {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const query = await props.searchParams;
  const editId = typeof query.edit === "string" ? query.edit : null;
  const creating = query.new === "1";

  const supabase = await createClient();
  const [connectors, activeJobs, sports, membership] = await Promise.all([
    listConnectors(supabase, project.id),
    listActiveFetchJobs(supabase, project.id),
    listSports(),
    supabase.from("project_members").select("role").eq("project_id", project.id).eq("user_id", user.id).maybeSingle(),
  ]);
  const canEdit = membership.data?.role !== undefined && membership.data.role !== "viewer";
  const editing = editId ? connectors.find((c) => c.id === editId) ?? null : null;
  const sportName = new Map(sports.map((s) => [s.id, s.name]));

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Source connectors"
        description={`${project.name} · RSS feeds and JSON APIs watched by the Sports Radar. Fetching runs in the background worker, never in your session.`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/radar">
                <ArrowLeft aria-hidden />
                Sports Radar
              </Link>
            </Button>
            {canEdit && !creating && !editing ? (
              <Button asChild size="sm">
                <Link href="/radar/connectors?new=1">
                  <Plus aria-hidden />
                  Add connector
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <aside className="flex items-start gap-3 rounded-md border bg-card/60 px-3 py-2.5 text-xs" aria-label="How items are stored">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Links and summaries only.</span> Each article is stored as its link, title,
          byline and a short summary (max 500 characters) — never the full text or its media. Every item starts{" "}
          <span className="font-medium text-foreground">UNCHECKED</span>: rights are classified per asset in the{" "}
          <Link href="/rights" className="text-foreground underline underline-offset-2">
            Rights Center
          </Link>{" "}
          before anything enters production. Fixtures from JSON APIs become events.
        </p>
      </aside>

      {!canEdit ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Read-only: project editors can add, change or fetch connectors.
        </p>
      ) : null}

      {canEdit && (creating || editing) ? (
        <SectionCard
          title={editing ? `Edit connector · ${editing.name}` : "Add connector"}
          description="Public feeds and APIs only. Respect each publisher's terms: no scraping of sites that forbid it."
          testId="connector-editor"
        >
          <ConnectorForm key={editing?.id ?? "new"} value={editing ? toFormValues(editing) : EMPTY_CONNECTOR} sports={sports} />
        </SectionCard>
      ) : null}
      {editId && !editing ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          That connector was not found in this project.
        </p>
      ) : null}

      <SectionCard title="Connectors" count={connectors.length} testId="connectors-list">
        {connectors.length === 0 ? (
          <EmptyState>
            No connectors yet. Add an RSS feed or a JSON API: the worker fetches it on its interval and new items appear in the Sports
            Radar as sources and events.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last fetch</TableHead>
                {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.map((c) => (
                <TableRow key={c.id} data-testid="connector-row">
                  <TableCell className="max-w-72 align-top whitespace-normal">
                    <p className="truncate text-[13px] font-medium">{c.name}</p>
                    <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Link2 className="size-3 shrink-0" aria-hidden />
                      <span className="truncate" title={c.url}>
                        {hostOf(c.url)}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">{KIND_LABELS[c.kind]}</Badge>
                      <Badge variant="outline">{c.target === "events" ? "→ Events" : "→ Sources"}</Badge>
                      {c.sport_id && sportName.get(c.sport_id) ? <Badge variant="outline">{sportName.get(c.sport_id)}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="grid gap-1">
                      <EnabledBadge enabled={c.enabled} />
                      <span className="text-[11px] text-muted-foreground">Every {formatInterval(c.fetch_interval_minutes)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-80 align-top whitespace-normal">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <FetchStatusBadge status={c.last_status} />
                      {c.last_fetched_at ? (
                        <time className="text-[11px] text-muted-foreground" dateTime={c.last_fetched_at} title={new Date(c.last_fetched_at).toUTCString()}>
                          {formatRelative(c.last_fetched_at)}
                        </time>
                      ) : null}
                      {c.last_item_count !== null && c.last_status === "ok" ? (
                        <span className="text-[11px] text-muted-foreground tabular">{c.last_item_count} items</span>
                      ) : null}
                    </div>
                    {c.last_status === "error" && c.last_error ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-danger" title={c.last_error}>
                        {c.last_error}
                      </p>
                    ) : null}
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="align-top">
                      <ConnectorActions connectorId={c.id} name={c.name} enabled={c.enabled} activeJobId={activeJobs[c.id]} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
