"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ListChecks, Settings, Sunrise } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "oggi", href: "/oggi", label: "Oggi", icon: Sunrise },
  { key: "scelte", href: "/oggi?view=scelte", label: "Scelte", icon: ListChecks },
  { key: "settings", href: "/settings", label: "Impostazioni", icon: Settings },
] as const;

function useActive(): string | null {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  if (pathname.startsWith("/oggi")) return view === "scelte" ? "scelte" : "oggi";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

/** Navigation of the simple mode: sidebar (desktop) or bottom bar (phone). */
export function SimpleNav({ variant }: { variant: "sidebar" | "bottom" }) {
  const active = useActive();
  if (variant === "bottom") {
    return (
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <ul className="grid grid-cols-3">
          {ITEMS.map(({ key, href, label, icon: Icon }) => (
            <li key={key}>
              <Link
                href={href}
                prefetch={false}
                aria-current={active === key ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium", active === key ? "text-brand" : "text-muted-foreground")}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Main" className="flex-1 px-3 pt-2 pb-4">
      <ul className="grid gap-0.5">
        {ITEMS.map(({ key, href, label, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              prefetch={false}
              aria-current={active === key ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                active === key ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className={cn("size-4", active === key && "text-brand")} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
