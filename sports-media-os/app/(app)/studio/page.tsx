import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, Clapperboard, ExternalLink, FileText, ImageIcon, ListChecks, Type } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { StageBadge } from "@/components/content/badges";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { GeneratePackageButton, PackageExport, TitleOption } from "@/components/studio/studio-client";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import type { ContentStage } from "@/lib/content/stages";
import { getActiveProject } from "@/lib/projects/service";
import { listWork, packageMarkdown, studioPackage } from "@/lib/publishing/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Studio" };

const STUDIO_STAGES = ["script", "production", "review", "ready", "scheduled"] as const satisfies readonly ContentStage[];

export default async function StudioPage(props: PageProps<"/studio">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const db = await createClient();
  const sp = await props.searchParams;
  const items = await listWork(db, project.id, STUDIO_STAGES);
  const selectedId = typeof sp.id === "string" ? sp.id : items[0]?.id;
  const pkg = selectedId ? await studioPackage(db, project.id, selectedId) : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Step 3 · Produce"
        title="Studio"
        description="One place for everything an editor needs: script, hook, verified facts with sources, honest titles and a footage-free thumbnail brief. Export it and cut the video in Cutroom or your editor."
      />
      {items.length === 0 ? (
        <EmptyState>
          Nothing in production. Approve an opportunity and press “Start production”, then write the script in the{" "}
          <Link className="underline" href="/content">Pipeline</Link>.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Pieces in production" className="grid content-start gap-1.5">
            {items.map((i) => (
              <Link
                key={i.id}
                href={`/studio?id=${i.id}`}
                className={cn(
                  "rounded-xl border px-3 py-2.5 transition-colors",
                  i.id === selectedId ? "border-brand/50 bg-brand/8" : "bg-card/60 hover:border-brand/30",
                )}
              >
                <p className="line-clamp-2 text-sm font-medium">{i.title}</p>
                <div className="mt-1.5"><StageBadge stage={i.stage} /></div>
              </Link>
            ))}
          </nav>

          {pkg ? (
            <div className="grid min-w-0 gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card/80 p-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Production package</p>
                  <h2 className="mt-1 font-display text-2xl font-bold tracking-wide uppercase">{pkg.item.title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <StageBadge stage={pkg.item.stage} />
                    <Link href={`/content/${pkg.item.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      Open in Pipeline <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>
                <PackageExport markdown={packageMarkdown(pkg)} filename={`${pkg.item.title.slice(0, 60).replace(/[^\w-]+/g, "-")}.md`} />
              </div>

              {pkg.blockers.length ? (
                <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">Not publishable yet</p>
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">{pkg.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-5 xl:grid-cols-2">
                <SectionCard title="Script" description={pkg.script ? `Version ${pkg.script.version} · ${pkg.script.word_count ?? "–"} words` : undefined}>
                  {pkg.script ? (
                    <div className="grid gap-3 text-sm">
                      {pkg.hook ? (
                        <p className="rounded-lg border border-brand/30 bg-brand/8 p-3"><span className="mr-2 text-[11px] font-semibold tracking-wider text-brand uppercase">Hook</span>{pkg.hook}</p>
                      ) : null}
                      {(["context", "escalation", "reveal", "payoff", "cta"] as const).map((k) =>
                        pkg.script?.[k] ? (
                          <p key={k}><span className="mr-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{k}</span>{pkg.script[k]}</p>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <EmptyState><FileText className="mx-auto mb-2 size-5" />No current script. Generate one in the <Link className="underline" href={`/content/${pkg.item.id}?tab=script`}>Script Studio</Link>.</EmptyState>
                  )}
                </SectionCard>

                <SectionCard title="Verified facts" count={pkg.facts.length}>
                  {pkg.facts.length ? (
                    <ul className="grid gap-2 text-sm">
                      {pkg.facts.map((f) => (
                        <li key={f.id} className="flex gap-2">
                          <ListChecks className={cn("mt-0.5 size-4 shrink-0", f.status === "confirmed" ? "text-success" : "text-warning")} />
                          <span>{f.claim} <span className="text-xs text-muted-foreground">· {f.status}</span></span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>No facts yet. Add them in Research.</EmptyState>
                  )}
                  {pkg.sources.length ? (
                    <div className="mt-4 border-t pt-3">
                      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Sources</p>
                      <ul className="grid gap-1 text-xs">
                        {pkg.sources.map((s) => (
                          <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{s.title} <ExternalLink className="size-3" /></a></li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard title="Titles" description="Pick one. Scores weigh accuracy most.">
                  <div className="grid gap-2">
                    {pkg.titles.length ? pkg.titles.slice(0, 8).map((t) => <TitleOption key={t.id} id={t.id} text={t.text} score={t.overall_score} selected={t.is_selected} />) : (
                      <EmptyState><Type className="mx-auto mb-2 size-5" />No titles yet.</EmptyState>
                    )}
                    <GeneratePackageButton
                      contentItemId={pkg.item.id}
                      hasPackage={pkg.titles.length > 0}
                      disabledReason={pkg.item.story_id ? (pkg.facts.length ? undefined : "Add at least one fact in Research first.") : "Create the story in the Pipeline first."}
                    />
                  </div>
                </SectionCard>

                <SectionCard title="Thumbnail brief" description="Original graphic only — no player photos, broadcast frames or logos.">
                  {pkg.thumbnails.length ? (
                    <div className="grid gap-3">
                      {pkg.thumbnails.slice(0, 3).map((t) => (
                        <div key={t.id} className="rounded-xl border p-3">
                          <div className="grid aspect-video place-items-center rounded-lg bg-gradient-to-br from-brand/25 via-info/15 to-transparent">
                            <p className="px-4 text-center font-display text-3xl font-bold tracking-wide uppercase">{t.headline}</p>
                          </div>
                          <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
                            <div><dt className="inline font-medium text-foreground">Visual: </dt><dd className="inline">{t.visual_concept}</dd></div>
                            <div><dt className="inline font-medium text-foreground">Emotion: </dt><dd className="inline">{t.emotion} · {t.contrast}</dd></div>
                            <div><dt className="inline font-medium text-foreground">Image prompt: </dt><dd className="inline">{t.image_prompt}</dd></div>
                          </dl>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState><ImageIcon className="mx-auto mb-2 size-5" />Generated together with the titles.</EmptyState>
                  )}
                </SectionCard>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/60 p-5">
                <div className="flex items-start gap-3">
                  <Clapperboard className="mt-0.5 size-5 text-brand" />
                  <div>
                    <p className="font-medium">Cut the video</p>
                    <p className="text-sm text-muted-foreground">Record the voice-over from the script, then build the Short in Cutroom (repo folder <code>cutroom/</code>) or your editor. When it passes review, move it to READY and schedule it.</p>
                  </div>
                </div>
                <Button asChild variant="outline"><Link href="/calendar">Go to Calendar <ArrowRight /></Link></Button>
              </div>
            </div>
          ) : (
            <EmptyState>Pick a piece on the left.</EmptyState>
          )}
        </div>
      )}
    </div>
  );
}
