"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";

import { activeModuleKey, MODULES, NAV_GROUPS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { MODULE_ICONS } from "./module-icons";

/** Desktop sidebar: grouped by the editorial workflow (Discover → Learn). */
export function AppSidebar() {
  const pathname = usePathname();
  const active = activeModuleKey(pathname);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur md:flex">
      <Link href="/dashboard" prefetch={false} className="flex h-14 items-center gap-2.5 px-4">
        <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-foreground shadow-[0_0_24px_-4px_var(--brand)]">
          <Radar className="size-4" />
        </span>
        <span className="leading-tight">
          <span className="block font-display text-base font-bold tracking-wide uppercase">Sports Media</span>
          <span className="block text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Operating system</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-4">
            {group.key !== "home" ? (
              <p className="flex items-center gap-2 px-2 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                {group.step ? (
                  <span className="grid size-4 place-items-center rounded-full border border-sidebar-border text-[9px] tabular">
                    {group.step}
                  </span>
                ) : null}
                {group.label}
              </p>
            ) : null}
            <ul className="grid gap-0.5">
              {MODULES.filter((m) => m.group === group.key).map((m) => {
                const Icon = MODULE_ICONS[m.key];
                const isActive = active === m.key;
                return (
                  <li key={m.key}>
                    <Link
                      prefetch={false}
                      href={m.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r before:bg-brand"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("size-4", isActive ? "text-brand" : "opacity-80")} />
                      <span className="flex-1 truncate">{m.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
