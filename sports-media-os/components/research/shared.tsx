import Link from "next/link";
import { ExternalLink, Scale } from "lucide-react";

import type { ResearchItemView, SourceRef, WorkspaceSource } from "@/lib/research/service";

import { AIBadge, RightsBadge } from "./badges";
import type { ItemFormValue, SourceOption } from "./item-forms";

/** Server-side helpers shared by the workspace panels. */

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Source picker options: "Headline — Publisher". */
export function sourceOptions(sources: readonly WorkspaceSource[]): SourceOption[] {
  return sources.map((s) => ({
    id: s.id,
    label: truncate(s.title && s.title !== s.name ? `${s.title} — ${s.name}` : s.name, 90),
  }));
}

export function toItemFormValue(item: ResearchItemView): ItemFormValue {
  return {
    title: item.title,
    content: item.content,
    url: item.url,
    occurredAt: item.occurredAt,
    sourceId: item.sourceId,
    speaker: item.meta.speaker,
    answered: item.meta.answered,
    answer: item.meta.answer,
    channel: item.meta.channel,
    platform: item.meta.platform,
    views: item.meta.views,
    mediaKind: item.meta.mediaKind,
  };
}

/**
 * The Rights Center is where assets are classified; `?source=` lets it focus
 * the asset (it lists every asset either way).
 */
export function rightsHref(sourceId?: string | null) {
  return sourceId ? `/rights?source=${sourceId}` : "/rights";
}

/** External link to a source (opens in a new tab, never followed by the server). */
export function SourceLink({ source, className }: { source: Pick<SourceRef, "name" | "title" | "url">; className?: string }) {
  const label = source.title ?? source.name;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className ?? "inline-flex max-w-full items-center gap-1 text-xs hover:underline"}
      title={source.url}
    >
      <span className="min-w-0 truncate">{label}</span>
      {source.title && source.title !== source.name ? <span className="shrink-0 text-muted-foreground">· {source.name}</span> : null}
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function ExternalUrl({ url, label }: { url: string; label?: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // keep the raw value
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs hover:underline" title={url}>
      <span className="truncate">{label ?? host}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Rights badge + link to classify the asset in the Rights Center. */
export function AssetRights({ source }: { source: Pick<SourceRef, "id" | "rightsStatus" | "usableInProduction"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <RightsBadge status={source.rightsStatus} usable={source.usableInProduction} />
      <Link href={rightsHref(source.id)} className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
        <Scale className="size-3" aria-hidden />
        {source.rightsStatus === "unchecked" ? "Classify" : "Rights Center"}
      </Link>
    </span>
  );
}

/** Agent-created items keep an AI badge, so their origin stays visible after edits. */
export function Provenance({ item }: { item: ResearchItemView }) {
  if (!item.createdByAgent && !item.meta.ai) return null;
  return <AIBadge model={item.meta.model} label={item.createdByAgent === "researcher" ? "Researcher agent" : "AI suggestion"} />;
}
