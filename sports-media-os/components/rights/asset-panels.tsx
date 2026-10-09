import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Film, Microscope, Scissors, Target } from "lucide-react";

import { EmptyState } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { formatCount, humanize } from "@/lib/dashboard/format";
import { ASSET_KINDS, assetKindLabel } from "@/lib/rights/schema";
import type { AssetDetail } from "@/lib/rights/service";

import { formatRightsTime } from "./check-history";

/** Asset facts (what the record says) and where the asset is used. Server components. */

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function AssetFacts({ detail, timeZone }: { detail: AssetDetail; timeZone: string }) {
  const { asset, details } = detail;
  if (details.type === "source") {
    const registeredKind = ASSET_KINDS.find((k) => k.value === details.assetKind)?.label;
    return (
      <dl className="grid gap-2 text-xs" data-testid="asset-facts">
        <Fact term="Link">
          {asset.url ? (
            <a href={asset.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 hover:underline" title={asset.url}>
              <span className="min-w-0 truncate">{asset.url}</span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            "—"
          )}
        </Fact>
        <Fact term="Publisher">{asset.publisher ?? "—"}</Fact>
        <Fact term="Kind">{registeredKind ?? assetKindLabel("source", details.sourceType)}</Fact>
        <Fact term="Source license">{humanize(details.licenseStatus)}</Fact>
        {details.author ? <Fact term="Author">{details.author}</Fact> : null}
        {details.publishedAt ? <Fact term="Published">{formatRightsTime(details.publishedAt, timeZone)}</Fact> : null}
        <Fact term={details.fromConnector ? "Ingested" : "Added"}>
          {formatRightsTime(details.retrievedAt, timeZone)}
          {details.fromConnector ? " · from a connected source" : ""}
        </Fact>
        {details.summary ? <Fact term="Summary">{details.summary}</Fact> : null}
        <p className="pt-1 text-[11px] text-muted-foreground">Links are never downloaded or reposted by the system. The link is kept to identify the asset.</p>
      </dl>
    );
  }
  return (
    <dl className="grid gap-2 text-xs" data-testid="asset-facts">
      <Fact term="Kind">{assetKindLabel("video", details.container)}</Fact>
      <Fact term="File">{details.originalFilename ?? "—"}</Fact>
      {formatDuration(details.durationSec) ? <Fact term="Duration">{formatDuration(details.durationSec)}</Fact> : null}
      {formatBytes(details.sizeBytes) ? <Fact term="Size">{formatBytes(details.sizeBytes)}</Fact> : null}
      <Fact term="Processing">{humanize(details.status)}</Fact>
      <Fact term="Came from">
        {details.source ? (
          <Link href={`/rights/source/${details.source.id}`} className="hover:underline">
            {details.source.title}
          </Link>
        ) : (
          "No source link recorded"
        )}
      </Fact>
      {asset.createdAt ? <Fact term="Uploaded">{formatRightsTime(asset.createdAt, timeZone)}</Fact> : null}
    </dl>
  );
}

export function AssetUsagePanel({ detail }: { detail: AssetDetail }) {
  const { usage, asset } = detail;
  const used =
    usage.opportunities.length > 0 || usage.claims > 0 || usage.contentItems.length > 0 || usage.unassignedClips > 0 || usage.videos.length > 0;
  if (!used) {
    return (
      <EmptyState>
        {asset.assetType === "source"
          ? "Not used yet. Sources get linked when the research workspace cites them (sources, media, quotes) or claims use them as evidence."
          : "Not used yet. Clips cut from this upload in Clips and Content appear here."}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-3 text-xs" data-testid="asset-usage">
      {usage.opportunities.length ? (
        <div className="grid gap-1.5">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Research of opportunities</p>
          <ul className="grid gap-1.5">
            {usage.opportunities.map((o) => (
              <li key={o.id} className="grid gap-1 rounded-md border px-2.5 py-1.5" data-testid="usage-opportunity">
                <Link href={`/opportunities/${o.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                  <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{o.title}</span>
                </Link>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline">{humanize(o.status)}</Badge>
                  {o.itemTypes.map((t) => (
                    <Badge key={t} variant="secondary">
                      {humanize(t)}
                    </Badge>
                  ))}
                  <Link href={`/research/${o.id}`} className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline">
                    <Microscope className="size-3" aria-hidden />
                    Research
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {usage.claims > 0 ? (
        <p className="flex items-center gap-1.5">
          <FileText className="size-3.5 text-muted-foreground" aria-hidden />
          Cited as evidence by {formatCount(usage.claims)} claim{usage.claims === 1 ? "" : "s"}. Citing a source for a fact needs no clearance; showing it on screen does.
        </p>
      ) : null}
      {usage.videos.length ? (
        <div className="grid gap-1.5">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Uploads from this link</p>
          <ul className="grid gap-1">
            {usage.videos.map((v) => (
              <li key={v.id}>
                <Link href={`/rights/video/${v.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <Film className="size-3.5 text-muted-foreground" aria-hidden />
                  {v.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">Each upload has its own classification.</p>
        </div>
      ) : null}
      {usage.contentItems.length ? (
        <div className="grid gap-1.5">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Content using clips of it</p>
          <ul className="grid gap-1">
            {usage.contentItems.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-1.5" data-testid="usage-content">
                <Scissors className="size-3.5 text-muted-foreground" aria-hidden />
                <Link href="/content" className="hover:underline">
                  {c.title}
                </Link>
                <Badge variant="outline">{humanize(c.stage)}</Badge>
                <span className="text-muted-foreground">
                  {formatCount(c.clips)} clip{c.clips === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {usage.unassignedClips > 0 ? (
        <p className="text-muted-foreground">
          {formatCount(usage.unassignedClips)} clip{usage.unassignedClips === 1 ? "" : "s"} not attached to content yet.
        </p>
      ) : null}
    </div>
  );
}
