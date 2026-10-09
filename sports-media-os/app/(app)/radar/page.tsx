import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Crosshair, Link2, ListTree, Plus } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, SectionCard } from "@/components/dashboard/section-card";
import { DetectNow } from "@/components/radar/detect-now";
import { DeleteEventButton, EMPTY_EVENT, EventForm, type EventFormValue } from "@/components/radar/event-form";
import { EventList } from "@/components/radar/event-list";
import { RadarFilters } from "@/components/radar/radar-filters";
import { TrendCard } from "@/components/radar/trend-card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { formatRelative } from "@/lib/dashboard/format";
import { getActiveProject, listSports } from "@/lib/projects/service";
import { formatDateTime, summarizeDetection } from "@/lib/radar/format";
import { hasRadarFilters, isoToLocalInput, parseRadarFilters } from "@/lib/radar/schema";
import { canDelete, canEdit as canEditRole, getEvent, getMemberRole, getRadarBoard, type RadarEvent } from "@/lib/radar/service";
import { createClient } from "@/lib/supabase/server";
import { SWEET_SPOT } from "@/lib/trends/metrics";

export const metadata: Metadata = { title: "Sports Radar" };

function toFormValue(e: RadarEvent, tz: string): EventFormValue {
  return {
    id: e.id,
    title: e.title,
    sportId: e.sport_id,
    competition: e.competition,
    venue: e.venue,
    description: e.description,
    startsAt: isoToLocalInput(e.starts_at, tz),
    endsAt: isoToLocalInput(e.ends_at, tz),
    status: e.status,
    importance: e.importance,
  };
}

/**
 * Sports Radar — the editorial control room. Not a news feed: it ranks stories
 * by radar score (interest + curiosity + room to stand out) and surrounds
 * them with the schedule. Data comes only from connected sources, the Trend
 * Hunter's detection and manually entered events.
 */
export default async function RadarPage(props: PageProps<"/radar">) {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) redirect("/welcome");

  const query = await props.searchParams;
  const filters = parseRadarFilters(query);
  const tz = project.timezone;
  const rawEventId = typeof query.event === "string" ? query.event : null;
  const eventId = rawEventId && z.uuid().safeParse(rawEventId).success ? rawEventId : null;

  const supabase = await createClient();
  const now = new Date();
  const [board, sports, role, editing] = await Promise.all([
    getRadarBoard(supabase, project.id, filters, { tz, now }),
    listSports(),
    getMemberRole(supabase, project.id, user.id),
    eventId ? getEvent(supabase, project.id, eventId) : Promise.resolve(null),
  ]);
  const canEdit = canEditRole(role);
  const filtered = hasRadarFilters(filters);
  const last = board.detection.lastRun;
  const lastSummary = last?.status === "completed" ? summarizeDetection(last.result) : null;

  // custom windows end at the exclusive start of the next day (or now): show the last minute included
  const windowLabel = (w: { from: string; to: string; custom: boolean }, fallback: string) => {
    if (!w.custom) return fallback;
    const end = Date.parse(w.to);
    const shownEnd = end >= now.getTime() - 1000 && end <= now.getTime() + 1000 ? "now" : formatDateTime(new Date(end - 60_000).toISOString(), tz);
    return `${formatDateTime(w.from, tz)} → ${shownEnd}`;
  };

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Sports Radar"
        description={`${project.name} · stories ranked by radar score: high interest, high curiosity, low or medium competition. Not a news feed.`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/radar/connectors">
                <Link2 aria-hidden />
                Sources & connectors
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/trends">
                <ListTree aria-hidden />
                All trends
              </Link>
            </Button>
          </>
        }
      />

      <section
        aria-label="Trend detection"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs"
        data-testid="detection-strip"
      >
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Trend Hunter</span> clusters the last 48h of sources after every connector fetch.{" "}
          {last ? (
            <>
              Last run {formatRelative(last.finishedAt)}
              {last.status === "failed" ? ": failed (see Agents)" : lastSummary ? `: ${lastSummary}` : ""}.
            </>
          ) : (
            "No detection has run for this project yet."
          )}
        </p>
        <DetectNow activeJobId={board.detection.activeJobId} canEdit={canEdit} />
      </section>

      <SectionCard title="Filters">
        <RadarFilters filters={filters} sports={sports} tz={tz} />
      </SectionCard>

      <SectionCard
        title="Sweet spot"
        description={`Interest ≥ ${SWEET_SPOT.interest}, curiosity ≥ ${SWEET_SPOT.curiosity}, competition not high — the best stories to make now.`}
        count={board.sweetSpot.length}
        testId="radar-sweet-spot"
      >
        {board.sweetSpot.length ? (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {board.sweetSpot.map((t) => (
              <TrendCard key={t.id} trend={t} canEdit={canEdit} />
            ))}
          </div>
        ) : filtered ? (
          <EmptyState>
            No sweet-spot story matches these filters.{" "}
            <Link href="/radar" className="underline underline-offset-2">
              Reset filters
            </Link>
          </EmptyState>
        ) : board.activeTrends === 0 ? (
          <EmptyState>
            No trends yet. Trends are detected from the sources your connectors collect: add an RSS feed or JSON API in{" "}
            <Link href="/radar/connectors" className="underline underline-offset-2">
              Sources & connectors
            </Link>
            , then run “Detect now” once the first fetch is in.
          </EmptyState>
        ) : (
          <EmptyState>
            No story is in the sweet spot right now ({board.activeTrends} active trend{board.activeTrends === 1 ? "" : "s"}). Every trend shows
            why on the{" "}
            <Link href="/trends" className="underline underline-offset-2">
              Trends page
            </Link>
            .
          </EmptyState>
        )}
      </SectionCard>

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <SectionCard
          title="Breaking & emerging"
          description="New or accelerating stories and anything carrying a breaking signal, by radar score."
          count={board.breaking.length}
          className="xl:col-span-3"
          testId="radar-breaking"
        >
          {board.breaking.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {board.breaking.map((t) => (
                <TrendCard key={t.id} trend={t} canEdit={canEdit} dense />
              ))}
            </div>
          ) : (
            <EmptyState>
              {filtered
                ? "No breaking or emerging story matches these filters."
                : "Nothing breaking or emerging. New stories appear here as soon as two outlets cover them, or one carries a strong signal."}
            </EmptyState>
          )}
        </SectionCard>

        <div className="grid gap-4 xl:col-span-2">
          <SectionCard
            title="Upcoming events"
            description={windowLabel(board.windows.upcoming, "Live now and the next 72 hours")}
            count={board.upcoming.length}
            testId="radar-upcoming"
          >
            <EventList
              events={board.upcoming}
              tz={tz}
              timeField="starts_at"
              canEdit={canEdit}
              now={now}
              empty="No events in this window. Events come from JSON API connectors (fixtures) or manual entry below."
            />
          </SectionCard>
          <SectionCard
            title="Just finished"
            description={windowLabel(board.windows.finished, "Finished in the last 24 hours")}
            count={board.finished.length}
            testId="radar-finished"
          >
            <EventList
              events={board.finished}
              tz={tz}
              timeField="ends_at"
              canEdit={canEdit}
              now={now}
              empty="No event finished in this window. Mark events as finished (manual entry) or let a fixtures connector update them."
            />
          </SectionCard>
        </div>
      </div>

      {eventId && editing && canEdit ? (
        <SectionCard title={`Edit event · ${editing.title}`} description={`Times in the project timezone (${tz}).`} testId="event-editor">
          <div id="event-editor" className="grid gap-3">
            <EventForm key={editing.id} value={toFormValue(editing, tz)} sports={sports} tz={tz} />
            {canDelete(role) ? <DeleteEventButton eventId={editing.id} title={editing.title} /> : null}
          </div>
        </SectionCard>
      ) : null}
      {rawEventId && (!editing || !canEdit) ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {canEdit ? "That event was not found in this project." : "Only project editors can edit events."}
        </p>
      ) : null}

      {canEdit ? (
        <details className="group rounded-lg border bg-card" data-testid="new-event">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium select-none">
            <Plus className="size-4 text-brand transition-transform group-open:rotate-45" aria-hidden />
            Add event
            <span className="text-xs font-normal text-muted-foreground">— fixtures no connector provides (times in {tz})</span>
          </summary>
          <div className="border-t px-4 py-4">
            <EventForm value={EMPTY_EVENT} sports={sports} tz={tz} />
          </div>
        </details>
      ) : (
        <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <Crosshair className="size-3.5" aria-hidden />
          Read-only: project editors can add events, run detection and create opportunities.
        </p>
      )}
    </div>
  );
}
