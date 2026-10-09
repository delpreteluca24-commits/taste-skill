import Link from "next/link";
import { AlertCircle, Clapperboard, Film, Microscope, VideoOff, type LucideIcon } from "lucide-react";
import { z } from "zod";

import { EmptyState } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/dal";
import { formatCount } from "@/lib/dashboard/format";
import { parseGuardError } from "@/lib/db/errors";
import { getActiveProject } from "@/lib/projects/service";
import { suggestEditorialAlternatives, type FootageStatus } from "@/lib/rights/alternatives";
import { FOOTAGE_STATUS_LABELS, footageHeadline, productionFormatOptions } from "@/lib/rights/schema";
import { loadStoryAlternatives } from "@/lib/rights/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { RightsStatusBadge, UsableBadge } from "./badges";
import { ProductionFormatsForm } from "./production-formats-form";

const FOOTAGE_META: Record<FootageStatus, { icon: LucideIcon; tone: string }> = {
  usable: { icon: Film, tone: "border-success/30 bg-success/10 text-success" },
  partial: { icon: Film, tone: "border-warning/30 bg-warning/10 text-warning" },
  unavailable: { icon: VideoOff, tone: "border-info/30 bg-info/10 text-info" },
  none: { icon: VideoOff, tone: "border-border bg-secondary/40 text-foreground" },
};

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-semibold tabular">{value}</dd>
    </div>
  );
}

/**
 * CONTRACT (owned by the Rights Center module):
 * STORY ≠ FOOTAGE panel for a story — footage status, suggested editorial formats
 * (lib/rights/alternatives.ts) and the selected stories.production_formats.
 *
 * Server component, scoped to the active project. The footage picture comes from
 * the assets' own rights (videos cut into the story's clips, media/video/article
 * sources of its opportunity's research); the research material (confirmed facts,
 * timeline, quotes) decides which original formats are strongest. No AI involved.
 */
export async function EditorialAlternativesPanel({ storyId }: { storyId: string }) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) return <EmptyState>Select a project to plan production formats.</EmptyState>;
  if (!z.uuid().safeParse(storyId).success) return <EmptyState>Story not found in this project.</EmptyState>;

  const supabase = await createClient();
  const res = await loadStoryAlternatives(supabase, project.id, storyId);
  if (res.error) {
    if (parseGuardError(res.error)?.code === "NOT_FOUND") return <EmptyState>Story not found in this project.</EmptyState>;
    return (
      <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
        Could not load the editorial alternatives. Reload the page to retry.
      </p>
    );
  }

  const { story, opportunity, assets, material, referenceArticles } = res.data;
  const result = suggestEditorialAlternatives(material);
  const meta = FOOTAGE_META[result.footageStatus];
  const FootageIcon = meta.icon;
  const usableCount = assets.filter((a) => a.usable).length;
  const options = productionFormatOptions(result.suggestions, story.productionFormats);

  return (
    <section className="grid gap-4" aria-label="Editorial alternatives" data-testid="editorial-alternatives">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <Clapperboard className="size-3.5 text-brand" aria-hidden />
          Story ≠ footage
        </span>
        <span className="text-muted-foreground">Rights belong to assets; the story never depends on footage.</span>
        {opportunity ? (
          <Link href={`/research/${opportunity.id}`} className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
            <Microscope className="size-3" aria-hidden />
            Research: {opportunity.title}
          </Link>
        ) : null}
      </div>

      <div
        role="status"
        className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-xs", meta.tone)}
        data-testid="footage-status"
        data-status={result.footageStatus}
      >
        <FootageIcon className="mt-px size-4 shrink-0" aria-hidden />
        <span className="grid gap-0.5">
          <span className="font-semibold">
            {FOOTAGE_STATUS_LABELS[result.footageStatus]}
            {assets.length ? ` · ${formatCount(usableCount)} of ${formatCount(assets.length)} usable` : ""}
          </span>
          <span>{footageHeadline(result.footageStatus, result.headline, story.status)}</span>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Footage candidates</p>
          {assets.length ? (
            <ul className="grid gap-1.5" data-testid="story-assets">
              {assets.map((a) => (
                <li key={`${a.assetType}:${a.assetId}`} className="flex flex-wrap items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs" data-testid="story-asset">
                  <Link href={`/rights/${a.assetType}/${a.assetId}`} className="min-w-0 flex-1 truncate font-medium hover:underline" title={a.title}>
                    {a.title}
                  </Link>
                  <Badge variant="outline">{a.via === "clip" ? "Clip source" : "Research"}</Badge>
                  <RightsStatusBadge status={a.status} />
                  <UsableBadge usable={a.usable} status={a.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>
              No footage linked. Uploads cut into this story&apos;s clips and video, social or media sources from its research appear here with
              their rights.
            </EmptyState>
          )}
          <p className="text-[11px] text-muted-foreground">
            Classify assets in the Rights Center: GREEN may be used, YELLOW only after a person approves it (never by automated workflows), RED
            never.
          </p>
        </div>

        <div className="grid content-start gap-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Research material</p>
          <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="story-material">
            <Count label="Confirmed facts" value={formatCount(material.confirmedFacts)} />
            <Count label="Timeline events" value={formatCount(material.timelineItems)} />
            <Count label="Quotes" value={formatCount(material.quotes)} />
            <Count label="Numeric stats" value={material.hasStatistics ? "Yes" : "No"} />
            <Count label="Places" value={material.hasLocations ? "Yes" : "No"} />
            <Count label="Reference articles" value={formatCount(referenceArticles)} />
          </dl>
          <p className="text-[11px] text-muted-foreground">
            Only confirmed facts count. News articles are references for facts, not footage: they need no clearance unless shown on screen.
          </p>
        </div>
      </div>

      <ProductionFormatsForm storyId={story.id} options={options} selected={story.productionFormats} />
    </section>
  );
}
