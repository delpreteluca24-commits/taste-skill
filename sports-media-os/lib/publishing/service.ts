import "server-only";

import type { Db, Enums, Tables } from "@/lib/db/client";

/**
 * Studio, Calendar and Analytics reads/writes. RLS client + explicit project
 * filter on every query. Stage changes go through the DB guards (READY gate).
 */

export type Platform = Enums<"platform">;
export const PLATFORMS: readonly Platform[] = ["youtube", "tiktok", "instagram"];
export const PLATFORM_LABELS: Record<Platform, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" };

export type WorkItem = Pick<
  Tables<"content_items">,
  "id" | "title" | "stage" | "format" | "scheduled_at" | "published_at" | "target_platforms" | "predicted_score" | "story_id" | "opportunity_id"
> & { opportunity_score: number | null; metadata: Record<string, unknown> };

const WORK_COLUMNS =
  "id, title, stage, format, scheduled_at, published_at, target_platforms, predicted_score, story_id, opportunity_id, metadata, opportunities(opportunity_score)";

type WorkRow = Omit<WorkItem, "opportunity_score" | "metadata"> & {
  metadata: unknown;
  opportunities: { opportunity_score: number | null } | null;
};

function toWork(r: WorkRow): WorkItem {
  const { opportunities, metadata, ...rest } = r;
  return {
    ...rest,
    opportunity_score: opportunities?.opportunity_score ?? null,
    metadata: metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {},
  };
}

/** Predicted score: the item's own, else the opportunity score it came from. */
export function predictedOf(i: Pick<WorkItem, "predicted_score" | "opportunity_score">): number | null {
  return i.predicted_score ?? i.opportunity_score ?? null;
}

export async function listWork(db: Db, projectId: string, stages: readonly Enums<"content_stage">[]) {
  const { data, error } = await db
    .from("content_items")
    .select(WORK_COLUMNS)
    .eq("project_id", projectId)
    .in("stage", stages as Enums<"content_stage">[])
    .order("stage_changed_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data as unknown as WorkRow[]).map(toWork);
}

export async function listCalendar(db: Db, projectId: string, fromIso: string, toIso: string) {
  const { data, error } = await db
    .from("content_items")
    .select(WORK_COLUMNS)
    .eq("project_id", projectId)
    .or(`and(scheduled_at.gte.${fromIso},scheduled_at.lt.${toIso}),and(published_at.gte.${fromIso},published_at.lt.${toIso})`)
    .limit(500);
  if (error) throw new Error(error.message);
  return (data as unknown as WorkRow[]).map(toWork);
}

export type StudioPackage = {
  item: WorkItem;
  script: Pick<Tables<"scripts">, "id" | "version" | "hook" | "context" | "escalation" | "reveal" | "payoff" | "cta" | "full_text" | "word_count" | "target_duration_sec"> | null;
  hook: string | null;
  facts: Pick<Tables<"facts">, "id" | "claim" | "status" | "is_critical">[];
  sources: { title: string; url: string; publisher: string }[];
  titles: Pick<Tables<"titles">, "id" | "text" | "overall_score" | "accuracy_score" | "curiosity_score" | "is_selected">[];
  thumbnails: Pick<Tables<"thumbnails">, "id" | "headline" | "visual_concept" | "emotion" | "contrast" | "curiosity_angle" | "image_prompt">[];
  blockers: string[];
};

export async function studioPackage(db: Db, projectId: string, id: string): Promise<StudioPackage | null> {
  const { data: row, error } = await db.from("content_items").select(WORK_COLUMNS).eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const item = toWork(row as unknown as WorkRow);

  const factFilter = [`content_item_id.eq.${item.id}`];
  if (item.story_id) factFilter.push(`story_id.eq.${item.story_id}`);
  if (item.opportunity_id) factFilter.push(`opportunity_id.eq.${item.opportunity_id}`);

  const [script, hook, facts, titles, thumbs, blockers] = await Promise.all([
    item.story_id
      ? db.from("scripts").select("id, version, hook, context, escalation, reveal, payoff, cta, full_text, word_count, target_duration_sec").eq("project_id", projectId).eq("story_id", item.story_id).eq("is_current", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    item.story_id
      ? db.from("hooks").select("text").eq("project_id", projectId).eq("story_id", item.story_id).eq("is_selected", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("facts").select("id, claim, status, is_critical, fact_sources(sources(title, name, url))").eq("project_id", projectId).or(factFilter.join(",")).limit(80),
    db.from("titles").select("id, text, overall_score, accuracy_score, curiosity_score, is_selected").eq("project_id", projectId).eq("content_item_id", item.id).order("overall_score", { ascending: false, nullsFirst: false }).limit(30),
    db.from("thumbnails").select("id, headline, visual_concept, emotion, contrast, curiosity_angle, image_prompt").eq("project_id", projectId).eq("content_item_id", item.id).order("created_at", { ascending: false }).limit(12),
    db.rpc("content_item_blockers", { p_content_item_id: item.id }),
  ]);
  for (const r of [script, hook, facts, titles, thumbs]) if (r.error) throw new Error(r.error.message);

  type FactRow = StudioPackage["facts"][number] & { fact_sources: { sources: { title: string | null; name: string; url: string } | null }[] };
  const factRows = (facts.data ?? []) as unknown as FactRow[];
  const seen = new Set<string>();
  const sources: StudioPackage["sources"] = [];
  for (const f of factRows)
    for (const fs of f.fact_sources ?? [])
      if (fs.sources && !seen.has(fs.sources.url)) {
        seen.add(fs.sources.url);
        sources.push({ title: fs.sources.title ?? fs.sources.name, url: fs.sources.url, publisher: fs.sources.name });
      }

  return {
    item,
    script: script.data ?? null,
    hook: hook.data?.text ?? null,
    facts: factRows.filter((f) => f.status !== "false").map(({ id, claim, status, is_critical }) => ({ id, claim, status, is_critical })),
    sources,
    titles: titles.data ?? [],
    thumbnails: thumbs.data ?? [],
    blockers: (blockers.data as string[] | null) ?? [],
  };
}

/** Markdown production package: everything an editor needs, sources included. */
export function packageMarkdown(p: StudioPackage): string {
  const title = p.titles.find((t) => t.is_selected)?.text ?? p.titles[0]?.text ?? p.item.title;
  const s = p.script;
  const lines = [
    `# ${title}`,
    "",
    `Working title: ${p.item.title} · Format: ${p.item.format}`,
    "",
    "## Hook (first 2–3 s)",
    p.hook ?? s?.hook ?? "_not chosen yet_",
    "",
    "## Script",
    s
      ? [
          ["Hook", s.hook], ["Context", s.context], ["Escalation", s.escalation], ["Reveal", s.reveal], ["Payoff", s.payoff], ["CTA", s.cta],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => `**${k}.** ${v}`)
          .join("\n\n") || s.full_text || ""
      : "_no current script_",
    "",
    "## Verified facts",
    ...(p.facts.length ? p.facts.map((f) => `- [${f.status}${f.is_critical ? ", critical" : ""}] ${f.claim}`) : ["_none_"]),
    "",
    "## Sources (cite on screen or in the description)",
    ...(p.sources.length ? p.sources.map((x) => `- ${x.title} — ${x.publisher} — ${x.url}`) : ["_none_"]),
    "",
    "## Title options",
    ...(p.titles.length ? p.titles.slice(0, 5).map((t) => `- ${t.text} (${t.overall_score ?? "–"})`) : ["_none_"]),
    "",
    "## Thumbnail brief (original graphic — no player photos, no broadcast frames, no logos)",
    ...(p.thumbnails.length
      ? p.thumbnails.slice(0, 3).flatMap((t, i) => [`### Option ${i + 1}: ${t.headline}`, `- Visual: ${t.visual_concept ?? ""}`, `- Emotion: ${t.emotion ?? ""} · Contrast: ${t.contrast ?? ""}`, `- Curiosity: ${t.curiosity_angle ?? ""}`, `- Image prompt: ${t.image_prompt ?? ""}`, ""])
      : ["_none_"]),
    "",
    "## Before publishing",
    "- [ ] Every number on screen matches a verified fact",
    "- [ ] No match/broadcast footage, no logos without permission",
    "- [ ] Captions on, audio ≈ −14 LUFS",
    "- [ ] AI-disclosure set if any realistic synthetic media is used",
  ];
  return lines.join("\n");
}

export type Metrics = Pick<
  Tables<"analytics">,
  "views" | "likes" | "comments" | "shares" | "subscribers_gained" | "avg_percentage_viewed" | "watch_time_sec"
>;

export async function latestMetrics(db: Db, projectId: string) {
  const { data, error } = await db
    .from("content_latest_metrics")
    .select("content_item_id, platform, captured_at, views, likes, comments, shares, subscribers_gained, avg_percentage_viewed, watch_time_sec")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
