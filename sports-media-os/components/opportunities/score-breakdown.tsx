import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatScore } from "@/lib/dashboard/format";
import type { ScoreNotes } from "@/lib/opportunities/scoring";
import type { OpportunityScore } from "@/lib/scoring/opportunity";

import { OriginBadge } from "./badges";
import { ResetComponentButton } from "./opportunity-forms";

/**
 * SCORE BREAKDOWN — all nine components with weight, value, points, origin and
 * the reason behind each number. Points = value × weight ÷ known weight, so
 * missing components are visible and never silently counted as zero.
 */
export function ScoreBreakdown({
  opportunityId,
  score,
  notes,
  editable,
}: {
  opportunityId: string;
  score: OpportunityScore;
  notes: ScoreNotes;
  editable: boolean;
}) {
  const knownWeight = score.components.filter((c) => c.value !== null).reduce((s, c) => s + c.weight, 0);
  return (
    <div className="grid gap-2">
      <Table data-testid="score-breakdown">
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead className="text-right">Weight</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Points</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Why</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {score.components.map((c) => (
            <TableRow key={c.key} data-component={c.key}>
              <TableCell className="text-[13px] font-medium">{c.label}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular">{c.weight}</TableCell>
              <TableCell className="text-right text-[13px] font-semibold tabular">{formatScore(c.value)}</TableCell>
              <TableCell className="text-right text-xs tabular">{c.value === null ? "—" : `+${formatScore(c.contribution)}`}</TableCell>
              <TableCell>
                <OriginBadge origin={c.origin} />
              </TableCell>
              <TableCell className="min-w-64 text-xs whitespace-normal text-muted-foreground">
                <span>{c.value === null ? (notes[c.key] ?? "Not scored yet.") : c.reason}</span>
                {editable && c.value !== null && c.origin !== "heuristic" ? (
                  <span className="ml-1 inline-block align-middle">
                    <ResetComponentButton id={opportunityId} component={c.key} label={c.label} />
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] text-muted-foreground">
        Points = value × weight ÷ known weight ({knownWeight} of 100). Missing components are not guessed: the score uses the known
        ones and coverage ({formatScore(score.coverage)}%) says how much of the model is scored.
      </p>
    </div>
  );
}
