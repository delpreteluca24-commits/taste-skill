import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  description,
  count,
  children,
  className,
  testId,
}: {
  title: string;
  description?: string;
  count?: number;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={cn("gap-3", className)} data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-[13px] tracking-tight uppercase">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {count !== undefined ? (
          <CardAction>
            <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground tabular">{count}</span>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

/** Empty state that says where the data will come from — no placeholder numbers. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>
  );
}
