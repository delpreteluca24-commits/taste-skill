import Form from "next/form";
import Link from "next/link";
import { Filter } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { humanize } from "@/lib/dashboard/format";
import { COMPETITION_LEVELS, EVENT_STATUS_LABELS, EVENT_STATUSES, hasRadarFilters, TREND_STATUSES, type RadarFilters as Filters } from "@/lib/radar/schema";

/**
 * Board filters as URL search params (/radar?sport=…&min=60): sport, date
 * range (project timezone), min radar score, trend status, editorial
 * competition and event status.
 */
export function RadarFilters({ filters, sports, tz }: { filters: Filters; sports: { id: string; name: string }[]; tz: string }) {
  return (
    <Form
      action="/radar"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]"
      data-testid="radar-filters"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="rf-sport">Sport</Label>
        <NativeSelect id="rf-sport" name="sport" defaultValue={filters.sportId ?? ""}>
          <option value="">Any</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-from">From</Label>
        <Input id="rf-from" name="from" type="date" defaultValue={filters.from ?? ""} aria-describedby="rf-tz" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-to">To</Label>
        <Input id="rf-to" name="to" type="date" defaultValue={filters.to ?? ""} aria-describedby="rf-tz" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-min">Min radar score</Label>
        <Input id="rf-min" name="min" type="number" min={0} max={100} step={1} placeholder="0–100" defaultValue={filters.minScore ?? ""} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-trend">Trend status</Label>
        <NativeSelect id="rf-trend" name="trend" defaultValue={filters.trendStatus ?? ""}>
          <option value="">Active (not expired)</option>
          {TREND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-competition">Competition</Label>
        <NativeSelect id="rf-competition" name="competition" defaultValue={filters.competition ?? ""}>
          <option value="">Any</option>
          {COMPETITION_LEVELS.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rf-status">Event status</Label>
        <NativeSelect id="rf-status" name="status" defaultValue={filters.eventStatus ?? ""}>
          <option value="">Any</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVENT_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm" variant="secondary">
          <Filter aria-hidden />
          Apply
        </Button>
        {hasRadarFilters(filters) ? (
          <Button asChild size="sm" variant="ghost">
            <Link href="/radar">Reset</Link>
          </Button>
        ) : null}
      </div>
      <p id="rf-tz" className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-4 xl:col-span-8">
        Dates are days in the project timezone ({tz}). A date range replaces the default windows (next 72h / last 24h); competition is
        editorial (how many outlets cover a story), not the league.
      </p>
    </Form>
  );
}
