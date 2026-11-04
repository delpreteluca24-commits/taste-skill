"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Pin } from "lucide-react";

import { cn } from "@/lib/utils";

export type AngleTab = { key: string; label: string; count: number; hasCurrent: boolean };

/** search param of the angle tab (kept distinct from the host page's own ?tab=) */
export const ANGLE_PARAM = "angle";

/**
 * Angle tabs as links (?angle=…): shareable, back-button friendly, and they
 * keep the host page's other search params. Panels are rendered on the server
 * and passed in; this only picks the one to show.
 */
export function AngleTabs({ tabs, panels, defaultKey }: { tabs: AngleTab[]; panels: Record<string, ReactNode>; defaultKey: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get(ANGLE_PARAM);
  const active = tabs.some((t) => t.key === requested) ? requested! : defaultKey;

  const href = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(ANGLE_PARAM, key);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="grid gap-3" data-testid="angle-tabs">
      <nav aria-label="Script angles" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => {
          const selected = t.key === active;
          return (
            <Link
              key={t.key}
              href={href(t.key)}
              scroll={false}
              aria-current={selected ? "page" : undefined}
              data-angle={t.key}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                selected ? "border-brand/50 bg-brand/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.hasCurrent ? <Pin className="size-3 text-info" aria-label="has the current version" /> : null}
              {t.label}
              <span className="rounded border px-1 text-[10px] tabular">{t.count}</span>
            </Link>
          );
        })}
      </nav>
      <div role="region" aria-label={tabs.find((t) => t.key === active)?.label ?? "Angle"}>
        {panels[active]}
      </div>
    </div>
  );
}
