"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODULES, NAV_GROUPS } from "@/lib/navigation";

import { MODULE_ICONS } from "./module-icons";

/** Compact navigation for small screens (the sidebar is desktop-only). */
export function MobileNav() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {NAV_GROUPS.map((g) =>
          MODULES.filter((m) => m.group === g.key).map((m, i) => {
            const Icon = MODULE_ICONS[m.key];
            return (
              <DropdownMenuItem key={m.key} asChild className={i === 0 && g.key !== "home" ? "mt-1 border-t pt-2" : undefined}>
                <Link href={m.href} prefetch={false}>
                  <Icon />
                  {m.label}
                  {i === 0 && g.step ? <span className="ml-auto text-[10px] text-muted-foreground uppercase">{g.step} · {g.label}</span> : null}
                </Link>
              </DropdownMenuItem>
            );
          }),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
