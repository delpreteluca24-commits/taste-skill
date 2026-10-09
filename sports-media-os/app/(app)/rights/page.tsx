import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Filter, Hourglass, ShieldCheck, ShieldQuestionMark, ShieldX, ShieldAlert } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { AssetTable, type AssetTableRow } from "@/components/rights/asset-table";
import { RegisterAssetForm } from "@/components/rights/register-asset-form";
import { RightsExplainer } from "@/components/rights/rights-explainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireUser } from "@/lib/auth/dal";
import { formatCount } from "@/lib/dashboard/format";
import { getActiveProject } from "@/lib/projects/service";
import { hasRightsFilters, parseRightsFilters, STATUS_FILTERS, TYPE_FILTERS } from "@/lib/rights/schema";
import { listAssets, rightsSummary } from "@/lib/rights/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rights Center" };

const STATUS_LABELS = { green: "GREEN", yellow: "YELLOW", red: "RED", unchecked: "Unchecked" } as const;

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function RightsPage(props: PageProps<"/rights">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const sp = await props.searchParams;
  // focus links from other modules (research workspace: ?source=<id>) open the asset itself
  for (const type of ["source", "video"] as const) {
    const id = firstParam(sp[type]);
    if (id && z.uuid().safeParse(id).success) redirect(`/rights/${type}/${id}`);
  }

  const filters = parseRightsFilters(sp);
  const supabase = await createClient();
  const [list, summary] = await Promise.all([listAssets(supabase, project.id, filters), rightsSummary(supabase, project.id)]);
  if (list.error || summary.error) throw new Error("Could not load the Rights Center");

  const s = summary.data;
  const filtered = hasRightsFilters(filters);
  const tz = project.timezone;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never";
  const rows: AssetTableRow[] = list.data.items.map((a) => ({ ...a, checkedLabel: when(a.checkedAt) }));
  const shown = rows.length < list.data.total ? `Showing ${rows.length} of ${list.data.total}. Narrow with the filters.` : null;

  const tiles = [
    { key: "green", label: "GREEN", value: s.green, hint: "may enter production", icon: ShieldCheck, href: "/rights?status=green" },
    {
      key: "yellow",
      label: "YELLOW",
      value: s.yellow,
      hint: `${formatCount(s.yellow - s.awaitingApproval)} approved for human use`,
      icon: ShieldAlert,
      href: "/rights?status=yellow",
    },
    { key: "awaiting", label: "Awaiting approval", value: s.awaitingApproval, hint: "YELLOW: a person decides", icon: Hourglass, href: "/rights?awaiting=1" },
    { key: "red", label: "RED", value: s.red, hint: "never enters production", icon: ShieldX, href: "/rights?status=red" },
    {
      key: "unchecked",
      label: "Unchecked",
      value: s.unchecked,
      hint: `${formatCount(s.uncheckedMedia)} media (video, social, uploads, images)`,
      icon: ShieldQuestionMark,
      href: "/rights?status=unchecked",
    },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Rights Center"
        description={`Every asset of ${project.name} with its rights classification. Rights belong to assets, never to stories; a person decides GREEN, YELLOW or RED.`}
      />

      <section aria-label="Rights summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="rights-summary">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`${t.label}: ${formatCount(t.value)} — ${t.hint}. Show these assets.`}
            data-testid={`rights-tile-${t.key}`}
          >
            <StatTile label={t.label} value={formatCount(t.value)} hint={t.hint} icon={t.icon} />
          </Link>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Register asset"
          description="A video link, social post, image or official material you may want on screen. Existing links are reused."
          className="lg:col-span-2"
          testId="register-asset"
        >
          <RegisterAssetForm />
        </SectionCard>
        <SectionCard title="How rights work" description="Enforced by the database, not just this screen.">
          <RightsExplainer />
        </SectionCard>
      </div>

      <SectionCard title="Filters">
        <Form action="/rights" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))_auto]" data-testid="rights-filters">
          <div className="grid gap-1.5">
            <Label htmlFor="rf-q">Search</Label>
            <Input id="rf-q" name="q" type="search" placeholder="Title, publisher or link contains…" defaultValue={filters.search ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-status">Rights status</Label>
            <NativeSelect id="rf-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Any</option>
              {STATUS_FILTERS.map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABELS[st]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-type">Type</Label>
            <NativeSelect id="rf-type" name="type" defaultValue={filters.type ?? ""}>
              <option value="">Any</option>
              {TYPE_FILTERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex h-9 items-center gap-2 text-xs whitespace-nowrap">
              <input type="checkbox" name="awaiting" value="1" defaultChecked={filters.awaitingApproval} className="size-3.5 accent-brand" />
              Awaiting approval
            </label>
            <Button type="submit" size="sm" variant="secondary">
              <Filter />
              Apply
            </Button>
            {filtered ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/rights">Reset</Link>
              </Button>
            ) : null}
          </div>
        </Form>
      </SectionCard>

      <SectionCard
        title="Assets"
        description={["Awaiting approval first, then newest.", shown].filter(Boolean).join(" ")}
        count={list.data.total}
        testId="asset-list"
      >
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState>
              No asset matches these filters.{" "}
              <Link href="/rights" className="underline underline-offset-2">
                Reset filters
              </Link>
            </EmptyState>
          ) : (
            <EmptyState>
              No assets yet. They arrive from connected sources (Radar → Connectors), links added in the research workspace and
              uploaded videos — or register a link above to classify it.
            </EmptyState>
          )
        ) : (
          <AssetTable rows={rows} />
        )}
      </SectionCard>
    </div>
  );
}
