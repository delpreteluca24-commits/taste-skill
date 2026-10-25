"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeModuleKey, getModule, type ModuleKey } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { MODULE_ICONS } from "./module-icons";

/** The five places a phone user goes most; everything else is in the ☰ menu. */
const TABS: { key: ModuleKey; label: string }[] = [
  { key: "dashboard", label: "Home" },
  { key: "opportunities", label: "Ideas" },
  { key: "content", label: "Pipeline" },
  { key: "studio", label: "Studio" },
  { key: "calendar", label: "Calendar" },
];

export function BottomNav() {
  const active = activeModuleKey(usePathname());
  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const Icon = MODULE_ICONS[t.key];
          const on = active === t.key;
          return (
            <li key={t.key}>
              <Link
                href={getModule(t.key).href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-wide uppercase transition-colors",
                  on ? "text-brand" : "text-muted-foreground active:text-foreground",
                )}
              >
                <Icon className={cn("size-5", on && "drop-shadow-[0_0_6px_var(--brand)]")} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
