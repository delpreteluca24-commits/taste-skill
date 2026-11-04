import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import { RADAR_SIGNALS, type RadarSignal } from "@/lib/radar/signals";
import { Constants } from "@/types/database";

/** Trend list filters from URL search params (/trends?status=rising&sweet=1…). */

export const TREND_STATUSES = Constants.public.Enums.trend_status;
export const COMPETITION_LEVELS = Constants.public.Enums.competition_level;

export type TrendStatus = Enums<"trend_status">;
export type CompetitionLevel = Enums<"competition_level">;

export type TrendFilters = {
  search?: string;
  status?: TrendStatus;
  competition?: CompetitionLevel;
  sportId?: string;
  minScore?: number;
  sweetSpot?: boolean;
  signal?: RadarSignal;
  /** expired trends are hidden unless asked for (or filtered by status=expired) */
  includeExpired?: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseTrendFilters(sp: SearchParams): TrendFilters {
  const f: TrendFilters = {};
  const status = first(sp.status);
  if (status && (TREND_STATUSES as readonly string[]).includes(status)) f.status = status as TrendStatus;
  const competition = first(sp.competition);
  if (competition && (COMPETITION_LEVELS as readonly string[]).includes(competition)) f.competition = competition as CompetitionLevel;
  const sport = first(sp.sport);
  if (sport && z.uuid().safeParse(sport).success) f.sportId = sport;
  const min = Number(first(sp.min));
  if (first(sp.min) && Number.isFinite(min) && min > 0 && min <= 100) f.minScore = min;
  if (first(sp.sweet) === "1") f.sweetSpot = true;
  if (first(sp.expired) === "1") f.includeExpired = true;
  const signal = first(sp.signal);
  if (signal && (RADAR_SIGNALS as readonly string[]).includes(signal)) f.signal = signal as RadarSignal;
  const q = first(sp.q);
  if (q) f.search = q.slice(0, 100);
  return f;
}

export function hasTrendFilters(f: TrendFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}

/** Search params of the filters (to keep them when opening a trend's detail panel). */
export function trendFilterParams(f: TrendFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set("q", f.search);
  if (f.status) p.set("status", f.status);
  if (f.competition) p.set("competition", f.competition);
  if (f.sportId) p.set("sport", f.sportId);
  if (f.minScore !== undefined) p.set("min", String(f.minScore));
  if (f.sweetSpot) p.set("sweet", "1");
  if (f.includeExpired) p.set("expired", "1");
  if (f.signal) p.set("signal", f.signal);
  return p;
}

/** escape LIKE wildcards so a search for "50%" is literal */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
