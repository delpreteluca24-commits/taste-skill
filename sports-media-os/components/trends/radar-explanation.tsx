import { CircleCheck, CircleX } from "lucide-react";

import { EmptyState } from "@/components/dashboard/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatScore } from "@/lib/dashboard/format";
import { SIGNAL_DESCRIPTIONS } from "@/lib/radar/signals";
import { CURIOSITY_BASE, type RadarExplanation as Explanation } from "@/lib/trends/metrics";

import { CompetitionBadge, SignalBadge, TrendStatusBadge } from "./badges";

/**
 * Every factor behind a trend's radar position, as stored at detection time
 * (trends.radar_explanation): interest factors with points, curiosity per
 * signal with the words that triggered it, competition rule, radar weights,
 * sweet-spot checks and the status rule. No black box.
 */
export function RadarExplanation({ explanation }: { explanation: Explanation | null }) {
  if (!explanation) {
    return <EmptyState>No radar explanation stored for this trend yet. It is computed at the next trend detection.</EmptyState>;
  }
  const e = explanation;
  return (
    <div className="grid gap-4 text-xs" data-testid="radar-explanation">
      <section aria-labelledby="exp-radar" className="grid gap-1.5">
        <h3 id="exp-radar" className="text-[12px] font-semibold tracking-tight uppercase">
          Radar score {formatScore(e.radar.score)}
        </h3>
        <p className="text-muted-foreground">
          {e.radar.weights.interest} × interest ({formatScore(e.interest.score)}) = {formatScore(e.radar.contributions.interest)} ·{" "}
          {e.radar.weights.curiosity} × curiosity ({formatScore(e.curiosity.score)}) = {formatScore(e.radar.contributions.curiosity)} ·{" "}
          {e.radar.weights.competition_gap} × competition gap ({e.competition.gap}) = {formatScore(e.radar.contributions.competition_gap)}
        </p>
      </section>

      <section aria-labelledby="exp-interest" className="grid gap-1.5">
        <h3 id="exp-interest" className="text-[12px] font-semibold tracking-tight uppercase">
          Interest {formatScore(e.interest.score)} / 100
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factor</TableHead>
              <TableHead>Why</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {e.interest.factors.map((f) => (
              <TableRow key={f.key} data-factor={f.key}>
                <TableCell className="font-medium">{f.label}</TableCell>
                <TableCell className="min-w-56 whitespace-normal text-muted-foreground">{f.detail}</TableCell>
                <TableCell className="text-right tabular">
                  {formatScore(f.points)} <span className="text-muted-foreground">/ {f.max}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="exp-curiosity" className="grid gap-1.5">
        <h3 id="exp-curiosity" className="text-[12px] font-semibold tracking-tight uppercase">
          Curiosity {formatScore(e.curiosity.score)} / 100
        </h3>
        <p className="text-muted-foreground">
          Base {CURIOSITY_BASE} + points per signal, scaled by the share of sources carrying it (points × (0.5 + 0.5 × share))
          {e.curiosity.capped ? `; raw ${formatScore(e.curiosity.raw)} capped at 100` : ""}.
        </p>
        {e.curiosity.factors.length === 0 ? (
          <p className="text-muted-foreground">No editorial signal detected in the headlines: curiosity stays at the base.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead className="text-right">Sources</TableHead>
                <TableHead className="text-right">Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.curiosity.factors.map((f) => (
                <TableRow key={f.signal} data-signal={f.signal}>
                  <TableCell>
                    <SignalBadge signal={f.signal} terms={f.terms} />
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="text-muted-foreground">{SIGNAL_DESCRIPTIONS[f.signal]}: </span>
                    {f.terms.length ? f.terms.map((t) => `“${t}”`).join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {f.sources} <span className="text-muted-foreground">({Math.round(f.share * 100)}%)</span>
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {formatScore(f.points)} <span className="text-muted-foreground">/ {f.max}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="exp-competition" className="grid content-start gap-1.5">
          <h3 id="exp-competition" className="text-[12px] font-semibold tracking-tight uppercase">
            Competition
          </h3>
          <div>
            <CompetitionBadge level={e.competition.level} />
          </div>
          <p className="text-muted-foreground">
            {e.competition.rule}. Saturation {Math.round(e.competition.saturation * 100)}% ({e.competition.publisher_count} of{" "}
            {e.competition.active_publishers} publishers active in the window). Gap {e.competition.gap}.
          </p>
        </section>

        <section aria-labelledby="exp-status" className="grid content-start gap-1.5">
          <h3 id="exp-status" className="text-[12px] font-semibold tracking-tight uppercase">
            Status and velocity
          </h3>
          <div>
            <TrendStatusBadge status={e.status.value} />
          </div>
          <p className="text-muted-foreground">
            {e.status.rule}. Velocity {e.velocity.value} ({e.velocity.unit}): {e.velocity.last_6h} sources in the last 6h vs{" "}
            {e.velocity.previous_6h} in the previous 6h.
          </p>
        </section>
      </div>

      <section aria-labelledby="exp-sweet" className="grid gap-1.5">
        <h3 id="exp-sweet" className="text-[12px] font-semibold tracking-tight uppercase">
          Sweet spot: {e.sweet_spot.value ? "yes" : "no"}
        </h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {e.sweet_spot.checks.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5" data-check={c.key} data-pass={c.pass}>
              {c.pass ? <CircleCheck className="size-3.5 text-success" aria-hidden /> : <CircleX className="size-3.5 text-danger" aria-hidden />}
              <span className="sr-only">{c.pass ? "Passed:" : "Failed:"}</span>
              {c.label}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Computed {new Date(e.computed_at).toISOString().slice(0, 16).replace("T", " ")} UTC · {e.version}
      </p>
    </div>
  );
}
