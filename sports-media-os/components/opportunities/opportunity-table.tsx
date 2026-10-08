"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Enums } from "@/lib/db/client";

import { AIScoreButton } from "./ai-score-button";
import { OpportunityStatusBadge, ScoreChip, SignalBadges, SweetSpotBadge } from "./badges";

export type OpportunityTableRow = {
  id: string;
  title: string;
  whyNow: string | null;
  status: Enums<"opportunity_status">;
  score: number | null;
  coverage: number | null;
  sport: string | null;
  competition: string | null;
  signals: string[];
  sweetSpot: boolean;
  /** formatted on the server (avoids hydration drift of relative times) */
  createdLabel: string;
};

/** at most this many per AI scoring batch (job payload limit) */
const MAX_BATCH = 50;

export function OpportunityTable({ rows, threshold }: { rows: OpportunityTableRow[]; threshold: number }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);
  const allSelected = rows.length > 0 && ids.length === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-card/60 px-3 py-2">
        <p className="pt-1.5 text-xs text-muted-foreground" aria-live="polite">
          {ids.length ? `${ids.length} selected` : "Select opportunities to refine their score with AI."}
          {ids.length > MAX_BATCH ? ` At most ${MAX_BATCH} per batch.` : ""}
        </p>
        <AIScoreButton key={ids.join(",")} ids={ids} disabled={ids.length === 0 || ids.length > MAX_BATCH} />
      </div>

      <Table data-testid="opportunity-table">
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all opportunities"
                className="size-3.5 accent-brand"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              />
            </TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Opportunity</TableHead>
            <TableHead>Sport · competition</TableHead>
            <TableHead>Signals</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.title}`}
                  className="size-3.5 accent-brand"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </TableCell>
              <TableCell>
                <ScoreChip score={r.score} coverage={r.coverage} threshold={threshold} />
              </TableCell>
              <TableCell className="max-w-96 whitespace-normal">
                <Link href={`/opportunities/${r.id}`} className="line-clamp-1 text-[13px] font-medium hover:underline">
                  {r.title}
                </Link>
                {r.whyNow ? <p className="line-clamp-1 text-[11px] text-muted-foreground">{r.whyNow}</p> : null}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {[r.sport, r.competition].filter(Boolean).join(" · ") || "—"}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1">
                  {r.sweetSpot ? <SweetSpotBadge /> : null}
                  <SignalBadges signals={r.signals} />
                </span>
              </TableCell>
              <TableCell>
                <OpportunityStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular">{r.createdLabel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
