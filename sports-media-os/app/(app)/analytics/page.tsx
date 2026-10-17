import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Percent, Sigma, UserPlus } from "lucide-react";

import { MetricsForm } from "@/components/analytics/metrics-form";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { formatCount } from "@/lib/dashboard/format";
import { getActiveProject } from "@/lib/projects/service";
import { calibrationVerdict, spearman } from "@/lib/publishing/learning";
import { latestMetrics, listWork, predictedOf } from "@/lib/publishing/service";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const db = await createClient();
  const [items, metrics] = await Promise.all([listWork(db, project.id, ["published", "analyzing"]), latestMetrics(db, project.id)]);

  const rows = items.map((i) => {
    const m = metrics.filter((x) => x.content_item_id === i.id);
    const views = m.reduce((s, x) => s + (x.views ?? 0), 0);
    const pct = m.filter((x) => x.avg_percentage_viewed !== null);
    return {
      item: i,
      platforms: m.map((x) => x.platform),
      hasMetrics: m.length > 0,
      views,
      avgPct: pct.length ? pct.reduce((s, x) => s + Number(x.avg_percentage_viewed), 0) / pct.length : null,
      subs: m.reduce((s, x) => s + (x.subscribers_gained ?? 0), 0),
      predicted: predictedOf(i),
    };
  });
  const measured = rows.filter((r) => r.hasMetrics);
  const pairs = measured.filter((r) => r.predicted !== null).map((r) => ({ predicted: r.predicted!, actual: r.views }));
  const rho = spearman(pairs);
  const median = (() => {
    const v = measured.map((r) => r.views).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  })();
  const pctRows = measured.filter((r) => r.avgPct !== null);

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Step 5 · Learn"
        title="Analytics"
        description="Log what each piece really did, compare it with the predicted score, and let the numbers decide what to make next."
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Views" value={formatCount(measured.reduce((s, r) => s + r.views, 0))} hint={`${measured.length} measured piece(s)`} icon={Eye} />
        <StatTile label="Avg % viewed" value={pctRows.length ? `${(pctRows.reduce((s, r) => s + r.avgPct!, 0) / pctRows.length).toFixed(1)}%` : "—"} hint="retention" icon={Percent} />
        <StatTile label="Subscribers" value={formatCount(measured.reduce((s, r) => s + r.subs, 0))} hint="gained" icon={UserPlus} />
        <StatTile label="Score accuracy" value={rho === null ? "—" : `ρ ${rho}`} hint="predicted vs views" icon={Sigma} />
      </section>

      <div className="rounded-2xl border border-info/25 bg-info/8 p-4 text-sm">
        <p className="font-medium">Learning loop</p>
        <p className="mt-0.5 text-muted-foreground">{calibrationVerdict(rho, pairs.length)}</p>
      </div>

      <SectionCard title="Predicted vs actual" count={rows.length}>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Piece</TableHead>
                <TableHead className="text-right">Predicted</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">vs median</TableHead>
                <TableHead className="text-right">Avg % viewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.item.id}>
                  <TableCell className="max-w-72 truncate"><Link href={`/studio?id=${r.item.id}`} className="hover:underline">{r.item.title}</Link></TableCell>
                  <TableCell className="text-right tabular">{r.predicted === null ? "—" : Math.round(r.predicted)}</TableCell>
                  <TableCell className="text-right tabular">{r.hasMetrics ? formatCount(r.views) : "—"}</TableCell>
                  <TableCell className="text-right tabular">
                    {r.hasMetrics && median > 0 ? (
                      <span className={r.views >= median * 1.3 ? "text-success" : r.views < median * 0.7 ? "text-danger" : ""}>{(r.views / median).toFixed(1)}×</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular">{r.avgPct === null ? "—" : `${r.avgPct.toFixed(1)}%`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState>Nothing published yet. Confirm a post in the <Link className="underline" href="/calendar">Calendar</Link> and it appears here.</EmptyState>
        )}
      </SectionCard>

      {rows.length ? (
        <SectionCard title="Log a snapshot" description="Best at +24 h and +7 days. Numbers come from YouTube Studio, TikTok or Instagram insights.">
          <div className="grid gap-5">
            {rows.map((r) => (
              <div key={r.item.id} className="grid gap-2 border-b pb-5 last:border-0 last:pb-0">
                <p className="text-sm font-medium">{r.item.title}</p>
                <MetricsForm contentItemId={r.item.id} platforms={r.item.target_platforms} />
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
