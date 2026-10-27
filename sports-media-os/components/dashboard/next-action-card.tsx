import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { NextAction } from "@/lib/dashboard/next-action";
import { NAV_GROUPS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Hero card: the next best action plus where it sits in the 5-step workflow. */
export function NextActionCard({ action }: { action: NextAction }) {
  const steps = NAV_GROUPS.filter((g) => g.step);
  return (
    <section
      aria-label="Next best action"
      data-testid="next-action"
      className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/12 via-card to-card p-5 md:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/10 blur-3xl" />
      <ol className="mb-4 flex flex-wrap gap-1.5">
        {steps.map((g) => (
          <li
            key={g.key}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase",
              g.step === action.step
                ? "border-brand bg-brand text-brand-foreground"
                : g.step! < action.step
                  ? "border-brand/30 text-brand"
                  : "border-border text-muted-foreground",
            )}
          >
            <span className="tabular">{g.step}</span> {g.label}
          </li>
        ))}
      </ol>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Next best action</p>
      <h2 className="mt-1 font-display text-2xl font-bold tracking-wide uppercase md:text-3xl">{action.title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{action.detail}</p>
      <Button asChild className="mt-4">
        <Link href={action.href}>
          {action.cta}
          <ArrowRight />
        </Link>
      </Button>
    </section>
  );
}
