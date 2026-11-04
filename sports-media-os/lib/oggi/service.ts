import type { Db } from "@/lib/db/client";

import { buildKit, italianSport, looksItalian, type Kit, type Signal } from "./kit";

export type IdeaSource = { title: string; url: string; publisher: string | null };

export type Idea = {
  id: string;
  title: string;
  status: "new" | "approved";
  score: number | null;
  sport: string | null;
  signals: Signal[];
  createdAt: string;
  sources: IdeaSource[];
  kit: Kit;
};

/** ideas older than this never reach "Oggi" */
export const FRESH_HOURS = 72;
/** potential lost per hour of age: a 2-day-old 80 ranks like a fresh 56 */
const AGE_PENALTY_PER_HOUR = 0.5;
/** foreign-language stories (US leagues…) stay available but below Italian ones */
const FOREIGN_PENALTY = 25;

/** Freshness-weighted rank: what is worth a video today, not the best score ever. */
export function rankScore(score: number | null, createdAt: string, now = Date.now(), title?: string): number {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  const foreign = title !== undefined && !looksItalian(title) ? FOREIGN_PENALTY : 0;
  return (score ?? 40) - ageHours * AGE_PENALTY_PER_HOUR - foreign;
}

type Row = {
  id: string;
  title: string;
  status: string;
  opportunity_score: number | null;
  sport_id: string | null;
  signals: Signal[] | null;
  created_at: string;
};

async function hydrate(db: Db, projectId: string, rows: Row[]): Promise<Idea[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sportIds = [...new Set(rows.map((r) => r.sport_id).filter((s): s is string => Boolean(s)))];
  const [items, sports] = await Promise.all([
    db
      .from("research_items")
      .select("opportunity_id, title, url, metadata, position")
      .eq("project_id", projectId)
      .in("opportunity_id", ids)
      .not("url", "is", null)
      .order("position", { ascending: true })
      .limit(ids.length * 6),
    sportIds.length ? db.from("sports").select("id, name").in("id", sportIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (items.error) throw new Error(items.error.message);
  const sportName = new Map((sports.data ?? []).map((s) => [s.id, s.name]));

  const byIdea = new Map<string, IdeaSource[]>();
  for (const it of items.data ?? []) {
    const list = byIdea.get(it.opportunity_id) ?? [];
    if (list.length >= 3 || !it.url) continue;
    const meta = (it.metadata ?? {}) as { publisher?: unknown };
    const publisher = typeof meta.publisher === "string" ? meta.publisher : null;
    // one link per publisher keeps the list varied
    if (publisher && list.some((s) => s.publisher === publisher)) continue;
    list.push({ title: it.title ?? it.url, url: it.url, publisher });
    byIdea.set(it.opportunity_id, list);
  }

  return rows.map((r) => {
    const sources = byIdea.get(r.id) ?? [];
    const sport = italianSport(r.sport_id ? (sportName.get(r.sport_id) ?? null) : null);
    const signals = r.signals ?? [];
    return {
      id: r.id,
      title: r.title,
      status: r.status === "approved" ? "approved" : "new",
      score: r.opportunity_score,
      sport,
      signals,
      createdAt: r.created_at,
      sources,
      kit: buildKit({ title: r.title, sport, signals, publishers: sources.map((s) => s.publisher).filter((p): p is string => Boolean(p)) }),
    };
  });
}

const COLUMNS = "id, title, status, opportunity_score, sport_id, signals, created_at";

/** Today's ideas: fresh, undecided, best first. `top` = the 5 to film today. */
export async function todayIdeas(db: Db, projectId: string, now = Date.now()) {
  const since = new Date(now - FRESH_HOURS * 3_600_000).toISOString();
  const { data, error } = await db
    .from("opportunities")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "new")
    .gte("created_at", since)
    .order("opportunity_score", { ascending: false, nullsFirst: false })
    .limit(60);
  if (error) throw new Error(error.message);
  const ranked = [...((data ?? []) as Row[])].sort((a, b) => rankScore(b.opportunity_score, b.created_at, now, b.title) - rankScore(a.opportunity_score, a.created_at, now, a.title));
  const ideas = await hydrate(db, projectId, ranked.slice(0, 15));
  return { top: ideas.slice(0, 5), more: ideas.slice(5) };
}

/** Ideas the user chose ("La faccio"), newest decision first. */
export async function chosenIdeas(db: Db, projectId: string) {
  const { data, error } = await db
    .from("opportunities")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return hydrate(db, projectId, (data ?? []) as Row[]);
}

/** When the radar last brought in news (shown as "aggiornato alle …"). */
export async function lastNewsAt(db: Db, projectId: string): Promise<string | null> {
  const { data } = await db.from("sources").select("created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.created_at ?? null;
}
