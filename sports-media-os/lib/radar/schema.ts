import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import { Constants } from "@/types/database";

/**
 * Radar board filters (URL search params) and the manual event form.
 * Dates typed by people are in the PROJECT timezone; they are converted to
 * UTC instants here (pure helpers, unit-tested).
 */

export const TREND_STATUSES = Constants.public.Enums.trend_status;
export const COMPETITION_LEVELS = Constants.public.Enums.competition_level;
export const EVENT_STATUSES = Constants.public.Enums.event_status;

export type TrendStatus = Enums<"trend_status">;
export type CompetitionLevel = Enums<"competition_level">;
export type EventStatus = Enums<"event_status">;

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  finished: "Finished",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

/* ------------------------------------------------------------------------- */
/* timezone helpers                                                          */
/* ------------------------------------------------------------------------- */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** offset (ms) of `tz` from UTC at `instant` (positive east of Greenwich) */
export function tzOffsetMs(instant: Date, tz: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
  } catch {
    return 0; // unknown zone → UTC
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** wall-clock time in `tz` → UTC instant (two passes so DST boundaries resolve) */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

/** "2026-10-10T20:45" typed in the project timezone → ISO instant, or null if invalid */
export function localInputToIso(value: string | null | undefined, tz: string): string | null {
  const m = value ? LOCAL_DATETIME.exec(value.trim()) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToUtc(y, mo, d, h, mi, tz).toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in the project timezone (datetime-local value) */
export function isoToLocalInput(value: string | null | undefined, tz: string): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const local = new Date(t + tzOffsetMs(new Date(t), tz));
  return local.toISOString().slice(0, 16);
}

/** "2026-10-10" → start of that day in `tz` (UTC instant) */
export function dayStartIso(day: string, tz: string): string | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return zonedToUtc(y, mo, d, 0, 0, tz).toISOString();
}

/** "2026-10-10" → start of the NEXT day in `tz` (exclusive end of that day) */
export function dayEndIso(day: string, tz: string): string | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz).toISOString();
}

/* ------------------------------------------------------------------------- */
/* board filters                                                             */
/* ------------------------------------------------------------------------- */

export type RadarFilters = {
  sportId?: string;
  /** YYYY-MM-DD in the project timezone */
  from?: string;
  to?: string;
  /** minimum radar score of trends */
  minScore?: number;
  trendStatus?: TrendStatus;
  /** editorial competition level of trends */
  competition?: CompetitionLevel;
  /** event status for the event sections */
  eventStatus?: EventStatus;
};

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseRadarFilters(sp: SearchParams): RadarFilters {
  const f: RadarFilters = {};
  const sport = first(sp.sport);
  if (sport && z.uuid().safeParse(sport).success) f.sportId = sport;
  const from = first(sp.from);
  if (from && DAY.test(from)) f.from = from;
  const to = first(sp.to);
  if (to && DAY.test(to)) f.to = to;
  if (f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from];
  const min = Number(first(sp.min));
  if (first(sp.min) && Number.isFinite(min) && min > 0 && min <= 100) f.minScore = min;
  const trend = first(sp.trend);
  if (trend && (TREND_STATUSES as readonly string[]).includes(trend)) f.trendStatus = trend as TrendStatus;
  const competition = first(sp.competition);
  if (competition && (COMPETITION_LEVELS as readonly string[]).includes(competition)) f.competition = competition as CompetitionLevel;
  const status = first(sp.status);
  if (status && (EVENT_STATUSES as readonly string[]).includes(status)) f.eventStatus = status as EventStatus;
  return f;
}

export function hasRadarFilters(f: RadarFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}

/* ------------------------------------------------------------------------- */
/* manual event form                                                         */
/* ------------------------------------------------------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Max ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));

const localDateTime = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || LOCAL_DATETIME.test(v), { message: "Use a valid date and time" })
  .transform((v) => (v ? v : null));

/** Raw form fields (strings). Times are converted with the project timezone afterwards. */
export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(300, "Max 300 characters"),
    sportId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.uuid().safeParse(v).success, { message: "Choose a sport from the list" }),
    competition: optionalText(120),
    venue: optionalText(200),
    description: optionalText(2000),
    startsAt: localDateTime,
    endsAt: localDateTime,
    status: z.enum(EVENT_STATUSES, { message: "Choose a status" }).default("scheduled"),
    importance: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? Number(v) : null))
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100), { message: "Importance is 0–100" }),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after the start" });
    }
    if (v.status === "finished" && !v.startsAt) {
      ctx.addIssue({ code: "custom", path: ["startsAt"], message: "A finished event needs its start time" });
    }
  });
export type EventFormValues = z.infer<typeof eventFormSchema>;

/** Validated values ready for the events table (times as UTC ISO strings). */
export type EventInput = {
  title: string;
  sport_id: string | null;
  competition: string | null;
  venue: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: EventStatus;
  importance: number | null;
};

export function toEventInput(values: EventFormValues, tz: string): EventInput {
  return {
    title: values.title,
    sport_id: values.sportId,
    competition: values.competition,
    venue: values.venue,
    description: values.description,
    starts_at: localInputToIso(values.startsAt, tz),
    ends_at: localInputToIso(values.endsAt, tz),
    status: values.status,
    importance: values.importance,
  };
}
