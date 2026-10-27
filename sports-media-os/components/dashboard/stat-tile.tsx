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
    <div className="rounded-xl border bg-card/80 px-4 py-3.5 shadow-sm backdrop-blur transition-colors hover:border-brand/30" data-testid="stat-tile">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
        <Icon aria-hidden className="size-4 text-brand/80" />
      </div>
      <p className="mt-1 font-display text-4xl font-bold tabular">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
