"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import { eventFormSchema, toEventInput } from "./schema";
import { createEvent, deleteEvent, getDetectionState, updateEvent } from "./service";

/**
 * Sports Radar actions. Every action: requireUser → zod → active project →
 * service (RLS client, also filtered by project) → user-safe error → revalidate.
 * No AI here: trend detection runs in the worker (trends.detect job).
 */

const uuid = z.uuid();

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

function revalidateRadar() {
  revalidatePath("/radar");
  revalidatePath("/trends");
  revalidatePath("/dashboard");
}

/** Shared create/update path: zod → project timezone → service (RLS + project filter). */
async function saveEvent(mode: "create" | "update", formData: FormData): Promise<ActionResult<{ eventId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");

  const id = text(formData, "id") || undefined;
  if (mode === "update" && (!id || !uuid.safeParse(id).success)) return fail("Invalid event.");
  const parsed = eventFormSchema.safeParse({
    title: text(formData, "title"),
    sportId: text(formData, "sportId"),
    competition: text(formData, "competition"),
    venue: text(formData, "venue"),
    description: text(formData, "description"),
    startsAt: text(formData, "startsAt"),
    endsAt: text(formData, "endsAt"),
    status: text(formData, "status") || undefined,
    importance: text(formData, "importance"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const input = toEventInput(parsed.data, ctx.project.timezone);
  const res = mode === "update" ? await updateEvent(ctx.db, ctx.project.id, id!, input) : await createEvent(ctx.db, ctx.project.id, input);
  if (res.error) {
    logger.warn("radar.event_save_failed", { projectId: ctx.project.id, eventId: id, mode, code: res.error.code });
    return fail(toUserMessage(res.error, "Could not save the event."));
  }
  logger.info(mode === "update" ? "radar.event_updated" : "radar.event_created", { projectId: ctx.project.id, eventId: res.data.id });
  revalidateRadar();
  if (mode === "update") redirect("/radar");
  return ok({ eventId: res.data.id }, "Event added to the radar.");
}

/** Manual event entry (fixtures that no connector provides). Times are typed in the project timezone. */
export async function createEventAction(_prev: ActionResult<{ eventId: string }> | null, formData: FormData): Promise<ActionResult<{ eventId: string }>> {
  return saveEvent("create", formData);
}

/** Update an event of the active project (form carries its id); back to the board on success. */
export async function updateEventAction(_prev: ActionResult<{ eventId: string }> | null, formData: FormData): Promise<ActionResult<{ eventId: string }>> {
  return saveEvent("update", formData);
}

/** Delete a manual or connector event (admins only, enforced by RLS). */
export async function deleteEventAction(eventId: string): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(eventId).success) return fail("Invalid event.");
  const res = await deleteEvent(ctx.db, ctx.project.id, eventId);
  if (res.error) {
    return fail(res.error.code === "42501" ? "Only project admins can delete events." : toUserMessage(res.error, "Could not delete the event."));
  }
  logger.info("radar.event_deleted", { projectId: ctx.project.id, eventId });
  revalidateRadar();
  return ok(undefined, "Event deleted.");
}

/**
 * "Detect trends now": enqueue trends.detect for the active project (48h
 * window). Reuses a detection that is already queued or running.
 */
export async function detectTrendsNowAction(): Promise<ActionResult<{ jobId: string; deduplicated: boolean }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");

  const state = await getDetectionState(ctx.db, ctx.project.id);
  if (state.activeJobId) return ok({ jobId: state.activeJobId, deduplicated: true }, "A detection is already queued.");

  const job = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "trends.detect",
    payload: { sinceHours: 48 },
    userId: ctx.user.id,
    idempotencyKey: `trends.detect:${ctx.project.id}:manual`,
    // a person is waiting: ahead of scheduled detections (45) and default jobs (50)
    priority: 60,
  });
  if (!job.ok) {
    logger.error("radar.detect_enqueue_failed", { projectId: ctx.project.id, code: job.code, message: job.error });
    return fail(toUserMessage({ code: job.code, message: job.error }, "Could not queue trend detection."));
  }
  logger.info("radar.detect_queued", { projectId: ctx.project.id, jobId: job.jobId, deduplicated: job.deduplicated });
  return ok({ jobId: job.jobId, deduplicated: job.deduplicated }, "Trend detection queued.");
}
