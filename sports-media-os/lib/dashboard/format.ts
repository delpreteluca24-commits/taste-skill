import type { PerformanceDay } from "./types";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");

/** 1,284 / 12.9K / 4.2M — exact below 10k, compact above. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Math.abs(value) < 10_000 ? integer.format(value) : compact.format(value);
}

/** Scores are 0..100; missing data stays visibly missing ("—"), never 0. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return (Math.round(value * 10) / 10).toString();
}

export type ScoreBand = "high" | "medium" | "low" | "none";

export function scoreBand(value: number | null | undefined, threshold = 70): ScoreBand {
  if (value === null || value === undefined) return "none";
  if (value >= threshold) return "high";
  if (value >= threshold - 20) return "medium";
  return "low";
}

/**
 * `recent_performance.views` is cumulative (latest snapshot at day end).
 * Views gained per day = difference from the previous day, floored at 0
 * (a platform correction must not render as negative growth).
 */
export function dailyViewGains(days: PerformanceDay[]): (PerformanceDay & { gained: number })[] {
  return days.map((d, i) => {
    const previous = i === 0 ? null : days[i - 1].views;
    const gained = previous === null ? 0 : Math.max(0, d.views - previous);
    return { ...d, gained };
  });
}

/** "2026-10-08" → "Oct 8" without timezone drift (the day is already project-local). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso);
  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(diffSec)) return "—";
  const abs = Math.abs(diffSec);
  const suffix = diffSec >= 0 ? "ago" : "from now";
  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.floor(abs / 60)}m ${suffix}`;
  if (abs < 86_400) return `${Math.floor(abs / 3600)}h ${suffix}`;
  return `${Math.floor(abs / 86_400)}d ${suffix}`;
}

/** Human label for enum values: "fact_checker" → "Fact checker". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
