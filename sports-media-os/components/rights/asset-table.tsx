import Link from "next/link";
import { Bot, ExternalLink, FileCheck } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assetKindLabel, ownershipLabel } from "@/lib/rights/schema";
import type { AssetListItem } from "@/lib/rights/service";

import { AwaitingApprovalBadge, RightsStatusBadge, UsableBadge } from "./badges";

export type AssetTableRow = AssetListItem & {
  /** formatted on the server (project timezone) */
  checkedLabel: string;
};

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Every asset with its current classification. Links open in a new tab and are never fetched by the server. */
export function AssetTable({ rows }: { rows: AssetTableRow[] }) {
  return (
    <Table data-testid="asset-table">
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Rights</TableHead>
          <TableHead>Production</TableHead>
          <TableHead>Ownership</TableHead>
          <TableHead>License</TableHead>
          <TableHead>Evidence</TableHead>
          <TableHead className="text-right">Last checked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const host = hostOf(r.url);
          return (
            <TableRow key={`${r.assetType}:${r.assetId}`} data-testid="asset-row" data-status={r.rightsStatus}>
              <TableCell className="max-w-96 whitespace-normal">
                <Link href={`/rights/${r.assetType}/${r.assetId}`} className="line-clamp-1 text-[13px] font-medium hover:underline">
                  {r.title}
                </Link>
                <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                  {r.publisher ? <span>{r.publisher}</span> : null}
                  {r.url && host ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
                      aria-label={`Open ${host} in a new tab`}
                    >
                      {r.publisher ? "· " : ""}
                      {host}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </p>
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{assetKindLabel(r.assetType, r.kind)}</TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1">
                  <RightsStatusBadge status={r.rightsStatus} />
                  {r.awaitingApproval ? <AwaitingApprovalBadge /> : null}
                </span>
              </TableCell>
              <TableCell>
                <UsableBadge usable={r.usable} status={r.rightsStatus} />
              </TableCell>
              <TableCell className="max-w-48 text-xs whitespace-normal">
                {r.ownership ? (
                  <>
                    <span className="line-clamp-1">{ownershipLabel(r.ownership)}</span>
                    {r.owner ? <span className="line-clamp-1 text-[11px] text-muted-foreground">{r.owner}</span> : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="max-w-48 text-xs whitespace-normal text-muted-foreground">
                <span className="line-clamp-2">{r.license ?? "—"}</span>
              </TableCell>
              <TableCell className="text-xs">
                {r.evidenceUrl ? (
                  <a
                    href={r.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 hover:underline"
                    aria-label={`Evidence for ${r.title} (opens in a new tab)`}
                  >
                    <FileCheck className="size-3.5 text-success" aria-hidden />
                    On file
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground tabular">
                <span className="inline-flex items-center gap-1">
                  {r.checkedByAgent ? <Bot className="size-3" aria-label="Classified by an agent" /> : null}
                  {r.checkedLabel}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
