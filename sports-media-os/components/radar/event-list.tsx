import type { ReactNode } from "react";
import Link from "next/link";
import { Ban, CalendarClock, CirclePause, Flag, Pencil, Radio, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/dashboard/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Enums } from "@/lib/db/client";
import { formatCountdown, formatDateTime } from "@/lib/radar/format";
import { EVENT_STATUS_LABELS } from "@/lib/radar/schema";
import type { RadarEvent } from "@/lib/radar/service";

type BadgeVariant = "outline" | "success" | "warning" | "danger" | "info" | "secondary";

const STATUS: Record<Enums<"event_status">, { icon: LucideIcon; variant: BadgeVariant }> = {
  scheduled: { icon: CalendarClock, variant: "outline" },
  live: { icon: Radio, variant: "danger" },
  finished: { icon: Flag, variant: "secondary" },
  postponed: { icon: CirclePause, variant: "warning" },
  cancelled: { icon: Ban, variant: "outline" },
};

export function EventStatusBadge({ status }: { status: Enums<"event_status"> }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} data-testid="event-status" data-status={status}>
      <Icon aria-hidden />
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Events of one radar section. Times in the project timezone; `timeField`
 * picks what the section is about (kick-off for upcoming, end for finished).
 */
export function EventList({
  events,
  tz,
  timeField,
  canEdit,
  empty,
  now = new Date(),
}: {
  events: RadarEvent[];
  tz: string;
  timeField: "starts_at" | "ends_at";
  canEdit: boolean;
  empty: ReactNode;
  now?: Date;
}) {
  if (events.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y" data-testid="event-list">
      {events.map((e) => {
        const time = (timeField === "ends_at" ? (e.ends_at ?? e.starts_at) : e.starts_at) ?? null;
        const details = [e.competition, e.venue, e.sport?.name].filter(Boolean).join(" · ");
        return (
          <li key={e.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0" data-testid="radar-event" data-event-id={e.id}>
            <div className="w-24 shrink-0 text-[11px] text-muted-foreground tabular">
              <time dateTime={time ?? undefined} className="block text-foreground">
                {formatCountdown(time, now)}
              </time>
              {formatDateTime(time, tz)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug font-medium">{e.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <EventStatusBadge status={e.status} />
                {details ? <span className="truncate">{details}</span> : null}
                {e.importance !== null ? <span title="Editorial importance 0–100">importance {e.importance}</span> : null}
                <span>{e.connector_id ? "from connector" : "manual"}</span>
              </div>
            </div>
            {canEdit ? (
              <Button asChild size="xs" variant="ghost">
                <Link href={`/radar?event=${e.id}#event-editor`} aria-label={`Edit ${e.title}`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
