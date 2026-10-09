/**
 * Research dates (pure). Forms read dates as UTC (lib/research/schema.ts →
 * parseDateInput), so they are shown in UTC too: a date-only value (00:00 UTC)
 * renders as a day, anything else as day + time with an explicit "UTC".
 */

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const isMidnightUtc = (d: Date) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

/** "4 Oct 2026" or "4 Oct 2026, 20:45 UTC"; missing stays visibly missing. */
export function formatResearchDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return isMidnightUtc(d) ? DAY.format(d) : `${DAY.format(d)}, ${TIME.format(d)} UTC`;
}

/** Machine-readable value for <time dateTime>. */
export function dateTimeAttr(iso: string | null | undefined): string | undefined {
  const d = parse(iso);
  return d ? d.toISOString() : undefined;
}

/**
 * Value + input type for editing a stored date without losing precision:
 * a date-only value edits as <input type="date">, a timed one as
 * "datetime-local" (both read back as UTC by parseDateInput).
 */
export function dateInputProps(iso: string | null | undefined): { type: "date" | "datetime-local"; defaultValue: string } {
  const d = parse(iso);
  if (!d) return { type: "date", defaultValue: "" };
  const s = d.toISOString();
  return isMidnightUtc(d) ? { type: "date", defaultValue: s.slice(0, 10) } : { type: "datetime-local", defaultValue: s.slice(0, 16) };
}
