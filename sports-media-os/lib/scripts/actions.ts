"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import {
  generateScriptsSchema,
  HOOKS_PER_RUN,
  manualHookSchema,
  manualVersionSchema,
  scriptDecisionSchema,
  selectHookSchema,
  transformScriptSchema,
} from "./schema";
import {
  addManualHook,
  createManualVersion,
  decideScript,
  getScriptRef,
  getStoryRef,
  selectHook,
  setCurrentScript,
  type ServiceError,
} from "./service";

/**
 * Script Studio & Hook Studio actions. Every action: requireUser → zod →
 * active project → service (RLS client, also filtered by project) → user-safe
 * error → revalidate. No AI here: generate / transform / hooks enqueue a
 * background job and return its id for <JobStatus>; the worker calls the model.
 */

const uuid = z.uuid();

export type QueuedJob = { jobId: string; deduplicated: boolean };

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

function errorMessage(error: ServiceError, fallback: string) {
  return error.userMessage ?? toUserMessage(error, fallback);
}

/** the studios live on the content item page (/content/[id]) */
function revalidateStudio() {
  revalidatePath("/content", "layout");
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

type Fields = Record<string, string[] | undefined>;
const invalidForm = (error: z.ZodError) => fail("Check the highlighted fields.", z.flattenError(error).fieldErrors as Fields);

/* ------------------------------------------------------------------------- */
/* AI jobs (enqueue only)                                                    */
/* ------------------------------------------------------------------------- */

/** Generate one version per checked angle (1–5; three pre-selected). */
export async function generateScriptsAction(_prev: ActionResult<QueuedJob> | null, formData: FormData): Promise<ActionResult<QueuedJob>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const picked = formData.getAll("angle").filter((v): v is string => typeof v === "string");
  const parsed = generateScriptsSchema.safeParse({ storyId: text(formData, "storyId"), angles: picked });
  if (!parsed.success) return invalidForm(parsed.error);

  const story = await getStoryRef(ctx.db, ctx.project.id, parsed.data.storyId);
  if (story.error) return fail(errorMessage(story.error, "Story not found."));

  const angles = [...parsed.data.angles].sort();
  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "script.generate",
    payload: { storyId: story.data.id, angles },
    userId: ctx.user.id,
    idempotencyKey: `script.generate:${story.data.id}:${angles.join(",")}`,
  });
  if (!res.ok) return fail(toUserMessage({ code: res.code, message: res.error }, "Could not queue the script generation."));
  logger.info("scripts.generate_enqueued", { projectId: ctx.project.id, storyId: story.data.id, angles, jobId: res.jobId, deduplicated: res.deduplicated });
  revalidateStudio();
  return ok(
    { jobId: res.jobId, deduplicated: res.deduplicated },
    res.deduplicated
      ? "Already generating these angles."
      : `Queued ${angles.length} angle${angles.length === 1 ? "" : "s"}. Each becomes a new version; nothing is approved automatically.`,
  );
}

/** Regenerate / shorten / expand / rewrite hook / change tone → always a NEW version. */
export async function transformScriptAction(input: { scriptId: string; operation: string; tone?: string | null }): Promise<ActionResult<QueuedJob>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = transformScriptSchema.safeParse(input);
  if (!parsed.success) return invalidForm(parsed.error);

  const script = await getScriptRef(ctx.db, ctx.project.id, parsed.data.scriptId);
  if (script.error) return fail(errorMessage(script.error, "Script version not found."));
  if (!script.data.hasText) return fail("This version has no text to rewrite.");

  const { operation, tone } = parsed.data;
  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "script.transform",
    payload: { scriptId: script.data.id, operation, ...(tone ? { tone } : {}) },
    userId: ctx.user.id,
    idempotencyKey: `script.transform:${script.data.id}:${operation}:${(tone ?? "").toLowerCase()}`,
  });
  if (!res.ok) return fail(toUserMessage({ code: res.code, message: res.error }, "Could not queue the rewrite."));
  logger.info("scripts.transform_enqueued", { projectId: ctx.project.id, scriptId: script.data.id, operation, jobId: res.jobId });
  revalidateStudio();
  return ok({ jobId: res.jobId, deduplicated: res.deduplicated }, res.deduplicated ? "Already running." : "Queued. The result is a new version.");
}

/** Hook agent: five (or more) scored hooks across hook types. */
export async function generateHooksAction(storyId: string): Promise<ActionResult<QueuedJob>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(storyId).success) return fail("Invalid story.");

  const story = await getStoryRef(ctx.db, ctx.project.id, storyId);
  if (story.error) return fail(errorMessage(story.error, "Story not found."));
  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "hooks.generate",
    payload: { storyId: story.data.id, count: HOOKS_PER_RUN },
    userId: ctx.user.id,
    idempotencyKey: `hooks.generate:${story.data.id}`,
  });
  if (!res.ok) return fail(toUserMessage({ code: res.code, message: res.error }, "Could not queue hook generation."));
  logger.info("scripts.hooks_enqueued", { projectId: ctx.project.id, storyId: story.data.id, jobId: res.jobId });
  revalidateStudio();
  return ok({ jobId: res.jobId, deduplicated: res.deduplicated }, res.deduplicated ? "Already generating hooks." : undefined);
}

/* ------------------------------------------------------------------------- */
/* versions                                                                  */
/* ------------------------------------------------------------------------- */

/** Manual edit → a NEW version (parent = current), which becomes current. */
export async function createManualVersionAction(
  _prev: ActionResult<{ id: string; version: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; version: number }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = manualVersionSchema.safeParse({
    storyId: text(formData, "storyId"),
    angle: text(formData, "angle") || null,
    hook: text(formData, "hook"),
    context: text(formData, "context"),
    escalation: text(formData, "escalation"),
    reveal: text(formData, "reveal"),
    payoff: text(formData, "payoff"),
    cta: text(formData, "cta"),
    tone: text(formData, "tone"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await createManualVersion(ctx.db, { projectId: ctx.project.id, userId: ctx.user.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not save the new version."));
  logger.info("scripts.manual_version", { projectId: ctx.project.id, storyId: parsed.data.storyId, scriptId: res.data.id, version: res.data.version });
  revalidateStudio();
  return ok(
    { id: res.data.id, version: res.data.version },
    `Saved as version ${res.data.version} (now current)${res.data.warnings ? ` with ${res.data.warnings} warning${res.data.warnings === 1 ? "" : "s"} to check` : ""}. It needs approval.`,
  );
}

export async function setCurrentScriptAction(scriptId: string): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(scriptId).success) return fail("Invalid script version.");

  const res = await setCurrentScript(ctx.db, { projectId: ctx.project.id, scriptId });
  if (res.error) return fail(errorMessage(res.error, "Could not switch the current version."));
  if (res.data.changed) logger.info("scripts.current_set", { projectId: ctx.project.id, scriptId, storyId: res.data.storyId });
  revalidateStudio();
  return ok(undefined, res.data.changed ? `Version ${res.data.version} is now current. Production needs its approval.` : "Already current.");
}

/** SCRIPT → APPROVAL (current version only), recorded by public.record_approval. */
export async function decideScriptAction(scriptId: string, decision: string, notes?: string | null): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = scriptDecisionSchema.safeParse({ scriptId, decision, notes });
  if (!parsed.success) return fail("Check the decision.", z.flattenError(parsed.error).fieldErrors as Fields);

  const res = await decideScript(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not record the decision."));
  logger.info("scripts.decided", { projectId: ctx.project.id, scriptId, storyId: res.data.storyId, decision: parsed.data.decision, userId: ctx.user.id });
  revalidateStudio();
  return ok(undefined, parsed.data.decision === "approved" ? "Script approved: production can start." : "Script rejected.");
}

/* ------------------------------------------------------------------------- */
/* hooks                                                                     */
/* ------------------------------------------------------------------------- */

export async function selectHookAction(hookId: string, selected: boolean): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = selectHookSchema.safeParse({ hookId, selected });
  if (!parsed.success) return fail("Invalid hook.");

  const res = await selectHook(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not update the hook."));
  revalidateStudio();
  return ok(undefined, parsed.data.selected ? "Hook selected." : "Selection cleared.");
}

export async function addManualHookAction(
  _prev: ActionResult<{ id: string; score: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; score: number }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = manualHookSchema.safeParse({
    storyId: text(formData, "storyId"),
    hookType: text(formData, "hookType"),
    text: text(formData, "text"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await addManualHook(ctx.db, { projectId: ctx.project.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not add the hook."));
  logger.info("scripts.hook_added", { projectId: ctx.project.id, storyId: parsed.data.storyId, hookId: res.data.id });
  revalidateStudio();
  return ok({ id: res.data.id, score: res.data.score }, `Hook added (score ${res.data.score}).`);
}
