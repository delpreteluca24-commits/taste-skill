"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { scoreHook } from "@/lib/scoring/hook";
import { createClient } from "@/lib/supabase/server";

/** Studio, Calendar and Analytics actions: requireUser → zod → project → RLS write → revalidate. */

const uuid = z.uuid();
const platform = z.enum(["youtube", "tiktok", "instagram"]);

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

function refresh() {
  for (const p of ["/studio", "/calendar", "/analytics", "/dashboard", "/content"]) revalidatePath(p);
}

export async function generatePackageAction(contentItemId: string): Promise<ActionResult<{ jobId: string; deduplicated: boolean }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(contentItemId).success) return fail("Invalid content item.");
  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "studio.package",
    payload: { contentItemId },
    userId: ctx.user.id,
    idempotencyKey: `studio.package:${contentItemId}`,
  });
  if (!res.ok) return fail(toUserMessage({ code: res.code, message: res.error }, "Could not queue packaging."));
  logger.info("studio.package_enqueued", { projectId: ctx.project.id, contentItemId, jobId: res.jobId });
  return ok({ jobId: res.jobId, deduplicated: res.deduplicated });
}

export async function selectTitleAction(titleId: string): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(titleId).success) return fail("Invalid title.");
  const { error } = await ctx.db.from("titles").update({ is_selected: true }).eq("id", titleId).eq("project_id", ctx.project.id);
  if (error) return fail(toUserMessage(error, "Could not select the title."));
  refresh();
  return ok(undefined, "Title selected.");
}

const manualSchema = z.object({
  contentItemId: uuid,
  kind: z.enum(["title", "thumbnail"]),
  text: z.string().trim().min(3, "Write at least 3 characters").max(200, "Keep it under 200 characters"),
});

/**
 * Manual title or thumbnail headline, so the Studio works without AI too. A
 * typed title becomes the selected one (the DB keeps one per piece) and gets
 * the same heuristic score as a hook.
 */
export async function addManualPackageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = manualSchema.safeParse({ contentItemId: formData.get("contentItemId"), kind: formData.get("kind"), text: formData.get("text") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { contentItemId, kind, text } = parsed.data;
  const { data: item } = await ctx.db.from("content_items").select("id").eq("id", contentItemId).eq("project_id", ctx.project.id).maybeSingle();
  if (!item) return fail("Content not found.");
  const base = { project_id: ctx.project.id, content_item_id: contentItemId, provider: "manual" };
  const { error } =
    kind === "title"
      ? await ctx.db.from("titles").insert({ ...base, text, overall_score: scoreHook(text).score, is_selected: true })
      : await ctx.db.from("thumbnails").insert({ ...base, headline: text.slice(0, 120) });
  if (error) return fail(toUserMessage(error, "Could not save it."));
  refresh();
  return ok(undefined, kind === "title" ? "Title added and selected." : "Thumbnail headline added.");
}

const scheduleSchema = z.object({
  id: uuid,
  scheduledAt: z.iso.datetime({ offset: true, error: "Pick a date and time" }),
  platforms: z.array(platform).min(1, "Pick at least one platform"),
});

/** Sets the slot; a READY piece moves to SCHEDULED (the DB re-checks facts and rights). */
export async function scheduleAction(input: { id: string; scheduledAt: string; platforms: string[] }): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid schedule.");
  const { id, scheduledAt, platforms } = parsed.data;
  const { data: item, error: readError } = await ctx.db.from("content_items").select("stage").eq("id", id).eq("project_id", ctx.project.id).maybeSingle();
  if (readError || !item) return fail("Content not found.");
  const patch: { scheduled_at: string; target_platforms: typeof platforms; stage?: "scheduled" } = { scheduled_at: scheduledAt, target_platforms: platforms };
  if (item.stage === "ready") patch.stage = "scheduled";
  const { error } = await ctx.db.from("content_items").update(patch).eq("id", id).eq("project_id", ctx.project.id);
  if (error) return fail(toUserMessage(error, "Could not schedule."));
  refresh();
  return ok(undefined, item.stage === "ready" ? "Scheduled." : "Slot saved. It moves to Scheduled once it is READY.");
}

const publishSchema = z.object({ id: uuid, url: z.url({ error: "Paste the full post URL" }).optional().or(z.literal("")) });

/** Manual publishing: the user posted it; we record it (the DB checks the READY gate). */
export async function markPublishedAction(input: { id: string; url?: string }): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { data: item } = await ctx.db.from("content_items").select("metadata").eq("id", parsed.data.id).eq("project_id", ctx.project.id).maybeSingle();
  if (!item) return fail("Content not found.");
  const metadata = { ...((item.metadata as Record<string, unknown>) ?? {}), ...(parsed.data.url ? { published_url: parsed.data.url } : {}) };
  const { error } = await ctx.db.from("content_items").update({ stage: "published", metadata }).eq("id", parsed.data.id).eq("project_id", ctx.project.id);
  if (error) return fail(toUserMessage(error, "Could not mark as published."));
  refresh();
  return ok(undefined, "Marked as published. Log its metrics in Analytics after 24 h.");
}

const count = z.coerce.number().int().min(0).max(1e12).optional();
const metricsSchema = z.object({
  contentItemId: uuid,
  platform,
  views: z.coerce.number().int().min(0).max(1e12),
  likes: count,
  comments: count,
  shares: count,
  subscribers_gained: z.coerce.number().int().min(-1e9).max(1e9).optional(),
  avg_percentage_viewed: z.coerce.number().min(0).max(100).optional(),
});

function num(v: FormDataEntryValue | null) {
  return v === null || v === "" ? undefined : v;
}

export async function addMetricsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = metricsSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    platform: formData.get("platform"),
    views: num(formData.get("views")),
    likes: num(formData.get("likes")),
    comments: num(formData.get("comments")),
    shares: num(formData.get("shares")),
    subscribers_gained: num(formData.get("subscribers_gained")),
    avg_percentage_viewed: num(formData.get("avg_percentage_viewed")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the numbers.");
  const { contentItemId, ...m } = parsed.data;
  const { error } = await ctx.db.from("analytics").insert({ project_id: ctx.project.id, content_item_id: contentItemId, ...m });
  if (error) return fail(toUserMessage(error, "Could not save the metrics."));
  refresh();
  return ok(undefined, "Metrics saved.");
}
