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
import { MODULES } from "@/lib/navigation";

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
        {MODULES.map((m) => {
          const Icon = MODULE_ICONS[m.key];
          return (
            <DropdownMenuItem key={m.key} asChild>
              <Link href={m.href}>
                <Icon />
                {m.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
