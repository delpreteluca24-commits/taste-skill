"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";

import { activeModuleKey, isModuleAvailable, MODULES, NAV_GROUPS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { MODULE_ICONS } from "./module-icons";

export function AppSidebar() {
  const pathname = usePathname();
  const active = activeModuleKey(pathname);

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <Link href="/dashboard" className="flex h-12 items-center gap-2 border-b border-sidebar-border px-4">
        <span className="grid size-6 place-items-center rounded bg-brand text-brand-foreground">
          <Radar className="size-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Sports Media OS</span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-3">
            <p className="px-2 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              {group.label}
            </p>
            <ul className="grid gap-0.5">
              {MODULES.filter((m) => m.group === group.key).map((m) => {
                const Icon = MODULE_ICONS[m.key];
                const isActive = active === m.key;
                const available = isModuleAvailable(m);
                return (
                  <li key={m.key}>
                    <Link
                      href={m.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("size-4", isActive && "text-brand")} />
                      <span className="flex-1 truncate">{m.label}</span>
                      {!available ? (
                        <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">
                          M{m.milestone}
                        </span>
                      ) : null}
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
