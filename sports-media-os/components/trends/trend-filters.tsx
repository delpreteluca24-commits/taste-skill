import Form from "next/form";
import Link from "next/link";
import { Filter } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { humanize } from "@/lib/dashboard/format";
import { RADAR_SIGNALS, SIGNAL_LABELS } from "@/lib/radar/signals";
import { COMPETITION_LEVELS, hasTrendFilters, TREND_STATUSES, type TrendFilters as Filters } from "@/lib/trends/schema";

/** GET form: filters live in the URL (/trends?status=rising&sweet=1…), so views are shareable. */
export function TrendFilters({ filters, sports }: { filters: Filters; sports: { id: string; name: string }[] }) {
  return (
    <Form
      action="/trends"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))_auto]"
      data-testid="trend-filters"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="tf-q">Search</Label>
        <Input id="tf-q" name="q" type="search" placeholder="Title contains…" defaultValue={filters.search ?? ""} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tf-status">Trend status</Label>
        <NativeSelect id="tf-status" name="status" defaultValue={filters.status ?? ""}>
          <option value="">Active (not expired)</option>
          {TREND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tf-competition">Competition</Label>
        <NativeSelect id="tf-competition" name="competition" defaultValue={filters.competition ?? ""}>
          <option value="">Any</option>
          {COMPETITION_LEVELS.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tf-sport">Sport</Label>
        <NativeSelect id="tf-sport" name="sport" defaultValue={filters.sportId ?? ""}>
          <option value="">Any</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tf-signal">Signal</Label>
        <NativeSelect id="tf-signal" name="signal" defaultValue={filters.signal ?? ""}>
          <option value="">Any</option>
          {RADAR_SIGNALS.map((s) => (
            <option key={s} value={s}>
              {SIGNAL_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tf-min">Min radar score</Label>
        <Input id="tf-min" name="min" type="number" min={0} max={100} step={1} placeholder="0–100" defaultValue={filters.minScore ?? ""} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-xs whitespace-nowrap">
            <input type="checkbox" name="sweet" value="1" defaultChecked={filters.sweetSpot} className="size-3.5 accent-brand" />
            Sweet spot only
          </label>
          <label className="flex items-center gap-2 text-xs whitespace-nowrap">
            <input type="checkbox" name="expired" value="1" defaultChecked={filters.includeExpired} className="size-3.5 accent-brand" />
            Include expired
          </label>
        </div>
        <Button type="submit" size="sm" variant="secondary">
          <Filter aria-hidden />
          Apply
        </Button>
        {hasTrendFilters(filters) ? (
          <Button asChild size="sm" variant="ghost">
            <Link href="/trends">Reset</Link>
          </Button>
        ) : null}
      </div>
    </Form>
  );
}
