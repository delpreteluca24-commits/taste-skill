import { dailyViewGains, formatCount, formatDay } from "@/lib/dashboard/format";
import type { PerformanceDay } from "@/lib/dashboard/types";

import { EmptyState } from "./section-card";

const CHART_HEIGHT = 112;

/**
 * Single-series column chart: views gained per day (project timezone).
 * Spec: ≤24px columns, 4px rounded data-end, square baseline, 2px gaps,
 * hairline baseline, per-column hover/focus tooltip, table view for screen readers.
 * Single series → no legend; the card title names it.
 */
export function ViewsChart({ days }: { days: PerformanceDay[] }) {
  const series = dailyViewGains(days);
  const max = Math.max(0, ...series.map((d) => d.gained));
  const totalPublished = series.reduce((sum, d) => sum + d.published, 0);

  if (series.length === 0 || (max === 0 && totalPublished === 0)) {
    return (
      <EmptyState>
        No performance data yet. Views appear after publishing and analytics sync (Milestone 5) or manual entry.
      </EmptyState>
    );
  }

  const peak = series.reduce((best, d) => (d.gained > best.gained ? d : best), series[0]);

  return (
    <figure className="grid gap-2">
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span>
          Peak <span className="font-semibold text-foreground">{formatCount(peak.gained)}</span> on {formatDay(peak.day)}
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-semibold text-foreground">{totalPublished}</span> published in 14 days
        </span>
      </div>
      <div className="relative flex items-end gap-0.5 border-b" style={{ height: CHART_HEIGHT }} aria-hidden>
        {series.map((d) => {
          const h = max === 0 ? 0 : Math.max(d.gained > 0 ? 2 : 0, Math.round((d.gained / max) * CHART_HEIGHT));
          return (
            <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0}>
              <div className="w-full max-w-6 rounded-t bg-chart-1 transition-opacity group-hover:opacity-80" style={{ height: h }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-[11px] whitespace-nowrap shadow-md group-hover:block group-focus:block">
                <span className="font-semibold text-foreground">{formatCount(d.gained)}</span>
                <span className="text-muted-foreground"> views · {formatDay(d.day)}</span>
                <span className="block text-muted-foreground">{d.published} published</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular" aria-hidden>
        <span>{formatDay(series[0].day)}</span>
        <span>{formatDay(series[series.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>Views gained and content published per day, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Views gained</th>
            <th scope="col">Published</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.gained}</td>
              <td>{d.published}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
