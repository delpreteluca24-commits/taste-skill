import { CircleAlert, Coins, Hash, Sigma, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/dashboard/section-card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatCost, formatTokens } from "./ai-format";
import type { AiUsageLine, AiUsageSummary } from "./ai-usage";

/**
 * AI usage for the active project, from the ai_usage ledger (every model call
 * the worker makes, success or failure). Unpriced calls are shown as such and
 * never folded into the total as $0.
 */
export function AiUsagePanel({ summary }: { summary: AiUsageSummary | null }) {
  if (!summary) {
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        Could not load AI usage. Refresh to retry.
      </p>
    );
  }
  if (summary.lines.length === 0) {
    return (
      <EmptyState>
        No AI calls yet — the worker logs every call here (task, model, tokens, cost) in the ai_usage ledger.
      </EmptyState>
    );
  }

  const t = summary.totals;
  const errorRate = t.calls ? Math.round((t.errors / t.calls) * 1000) / 10 : 0;

  return (
    <div className="grid gap-3" data-testid="ai-usage">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile
          label={`Cost · ${summary.days} days`}
          value={formatCost(t.costUsd)}
          hint={t.unpricedCalls ? `+ ${formatTokens(t.unpricedCalls)} unpriced call${t.unpricedCalls === 1 ? "" : "s"}` : "priced calls"}
          icon={Coins}
        />
        <StatTile label="Calls" value={formatTokens(t.calls)} hint="every attempt, incl. fallbacks" icon={Hash} />
        <StatTile label="Errors" value={formatTokens(t.errors)} hint={`${errorRate}% of calls · failed or refused`} icon={CircleAlert} />
        <StatTile
          label="Tokens in / out"
          value={`${compact(t.inputTokens)} / ${compact(t.outputTokens)}`}
          hint="output includes thinking"
          icon={Sigma}
        />
      </div>

      {t.unpricedModels.length ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span>
            No price for {t.unpricedModels.join(", ")}: their cost is unknown and not in the total. Add the price to{" "}
            <code>AI_PRICING_JSON</code> (USD per 1M tokens) to track it.
          </span>
        </p>
      ) : null}

      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="text-right">Tokens in</TableHead>
            <TableHead className="text-right">Tokens out</TableHead>
            <TableHead className="text-right">Cache read / write</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular">
          {summary.lines.map((line) => (
            <UsageRow key={`${line.task}:${line.provider}:${line.model}`} line={line} />
          ))}
          <TableRow className="border-t font-medium hover:bg-transparent">
            <TableCell colSpan={2}>Total</TableCell>
            <TableCell className="text-right">{formatTokens(t.calls)}</TableCell>
            <TableCell className="text-right">{formatTokens(t.errors)}</TableCell>
            <TableCell className="text-right">{formatTokens(t.inputTokens)}</TableCell>
            <TableCell className="text-right">{formatTokens(t.outputTokens)}</TableCell>
            <TableCell className="text-right">
              {formatTokens(t.cacheReadTokens)} / {formatTokens(t.cacheWriteTokens)}
            </TableCell>
            <TableCell className="text-right">
              {formatCost(t.costUsd)}
              {t.unpricedCalls ? <span className="block text-[10px] font-normal text-warning">excl. unpriced</span> : null}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="text-[11px] text-muted-foreground">
        Errors = failed or refused attempts (each fallback attempt counts as a call). Tokens in = uncached prompt tokens
        (prompt-cache reads/writes are listed separately); cost includes them, priced when each call was made. Benchmark runs are not in this ledger.
      </p>
    </div>
  );
}

function UsageRow({ line }: { line: AiUsageLine }) {
  return (
    <TableRow>
      <TableCell>{line.taskLabel}</TableCell>
      <TableCell>
        <code className="text-[11px]">
          {line.provider}:{line.model}
        </code>
      </TableCell>
      <TableCell className="text-right">{formatTokens(line.calls)}</TableCell>
      <TableCell className="text-right">
        {line.errors > 0 ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <CircleAlert aria-hidden className="size-3" />
            {formatTokens(line.errors)}
            <span className="sr-only"> failed or refused</span>
          </span>
        ) : (
          "0"
        )}
      </TableCell>
      <TableCell className="text-right">{formatTokens(line.inputTokens)}</TableCell>
      <TableCell className="text-right">{formatTokens(line.outputTokens)}</TableCell>
      <TableCell className="text-right">
        {formatTokens(line.cacheReadTokens)} / {formatTokens(line.cacheWriteTokens)}
      </TableCell>
      <TableCell className="text-right">
        {line.costState === "unpriced" ? (
          <Badge variant="warning" className="ml-auto">
            <TriangleAlert />
            Unpriced
          </Badge>
        ) : (
          formatCost(line.costUsd ?? 0)
        )}
      </TableCell>
    </TableRow>
  );
}

const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function compact(n: number): string {
  return n < 10_000 ? formatTokens(n) : compactFormat.format(n);
}
