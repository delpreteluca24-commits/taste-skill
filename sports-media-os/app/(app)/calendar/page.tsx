import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { MarkPublishedForm, ScheduleForm } from "@/components/calendar/calendar-actions";
import { PageHeader } from "@/components/common/page-header";
import { StageBadge } from "@/components/content/badges";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { getActiveProject } from "@/lib/projects/service";
import { listCalendar, listWork, PLATFORM_LABELS, type WorkItem } from "@/lib/publishing/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthOf(param: unknown) {
  const m = typeof param === "string" && /^\d{4}-\d{2}$/.test(param) ? param : null;
  const now = new Date();
  const [y, mo] = m ? m.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  return { y, mo };
}
const key = (y: number, mo: number) => `${y}-${String(mo).padStart(2, "0")}`;

export default async function CalendarPage(props: PageProps<"/calendar">) {
  await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");
  const db = await createClient();
  const { y, mo } = monthOf((await props.searchParams).month);
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 1));
  const tz = project.timezone;

  const [inMonth, queue] = await Promise.all([
    listCalendar(db, project.id, from.toISOString(), to.toISOString()),
    listWork(db, project.id, ["review", "ready", "scheduled"]),
  ]);

  const dayOf = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(new Date(iso)));
  const byDay = new Map<number, WorkItem[]>();
  for (const i of inMonth) {
    const when = i.published_at ?? i.scheduled_at;
    if (!when) continue;
    const d = dayOf(when);
    byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (from.getUTCDay() + 6) % 7;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "numeric" }).format(new Date());
  const prev = mo === 1 ? key(y - 1, 12) : key(y, mo - 1);
  const next = mo === 12 ? key(y + 1, 1) : key(y, mo + 1);
  const toSchedule = queue.filter((i) => !i.scheduled_at);
  const toPublish = queue.filter((i) => i.stage === "scheduled");
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Step 4 · Publish"
        title="Calendar"
        description={`Give every finished piece a slot, post it, then confirm it here. Times in ${tz}.`}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm" aria-label="Previous month"><Link href={`/calendar?month=${prev}`}><ChevronLeft /></Link></Button>
            <span className="min-w-36 text-center font-display text-xl font-bold tracking-wide uppercase">
              {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(from)}
            </span>
            <Button asChild variant="outline" size="icon-sm" aria-label="Next month"><Link href={`/calendar?month=${next}`}><ChevronRight /></Link></Button>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="overflow-x-auto rounded-2xl border bg-card/70 p-3">
          <div className="grid min-w-[640px] grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const items = byDay.get(day) ?? [];
              const isToday = todayKey === `${key(y, mo)}-${String(day).padStart(2, "0")}`;
              return (
                <div key={day} className={cn("min-h-24 rounded-lg border bg-background/40 p-1.5", isToday && "border-brand/60")}>
                  <p className={cn("mb-1 text-right text-xs tabular", isToday ? "font-bold text-brand" : "text-muted-foreground")}>{day}</p>
                  <div className="grid gap-1">
                    {items.map((i) => (
                      <Link
                        key={i.id}
                        href={`/studio?id=${i.id}`}
                        className={cn(
                          "truncate rounded px-1.5 py-1 text-[11px] font-medium",
                          i.published_at ? "bg-success/15 text-success" : "bg-brand/15 text-brand",
                        )}
                        title={i.title}
                      >
                        {time((i.published_at ?? i.scheduled_at)!)} {i.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand" />Scheduled</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" />Published</span>
          </div>
        </div>

        <div className="grid content-start gap-5">
          <SectionCard title="Needs a slot" count={toSchedule.length}>
            {toSchedule.length ? (
              <div className="grid gap-4">
                {toSchedule.map((i) => (
                  <div key={i.id} className="grid gap-2 border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/studio?id=${i.id}`} className="text-sm font-medium hover:underline">{i.title}</Link>
                      <StageBadge stage={i.stage} />
                    </div>
                    <ScheduleForm id={i.id} initialPlatforms={i.target_platforms} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>Nothing waiting. Pieces in Review or Ready appear here.</EmptyState>
            )}
          </SectionCard>
          <SectionCard title="Posted yet?" count={toPublish.length} description="Confirm once it is live on the platforms.">
            {toPublish.length ? (
              <div className="grid gap-4">
                {toPublish.map((i) => (
                  <div key={i.id} className="grid gap-2 border-b pb-4 last:border-0 last:pb-0">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.scheduled_at ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(i.scheduled_at)) : ""}
                      {i.target_platforms.length ? ` · ${i.target_platforms.map((p) => PLATFORM_LABELS[p]).join(", ")}` : ""}
                    </p>
                    <MarkPublishedForm id={i.id} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No scheduled pieces.</EmptyState>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
