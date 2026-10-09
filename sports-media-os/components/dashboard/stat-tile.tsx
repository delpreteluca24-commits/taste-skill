import type { LucideIcon } from "lucide-react";

/** Stat tile: label · value · hint. Missing data renders "—", never a fake zero. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3" data-testid="stat-tile">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
