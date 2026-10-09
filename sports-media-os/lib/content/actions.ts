"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import { contentFieldsSchema, ideaSchema, moveSchema, storyDecisionSchema } from "./schema";
import {
  createIdea,
  createStoryForItem,
  decideStory,
  move,
  updateItem,
  type MoveResult,
  type ServiceError,
} from "./service";
import { STAGE_LABELS } from "./stages";

/**
 * Content actions. Every action: requireUser → zod → active project → service
 * (RLS client, also filtered by project) → user-safe error → revalidate.
 * Moving a card never publishes anything and never calls a model.
 */

const uuid = z.uuid();

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

function errorMessage(error: ServiceError, fallback: string) {
  return error.userMessage ?? toUserMessage(error, fallback);
}

function revalidateContent(id?: string) {
  revalidatePath("/content");
  if (id) revalidatePath(`/content/${id}`);
  revalidatePath("/dashboard");
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

/** "New idea" form: the item starts in IDEA, at the top of the column. */
export async function createContentItem(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = ideaSchema.safeParse({
    title: text(formData, "title"),
    format: text(formData, "format"),
    description: text(formData, "description"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const res = await createIdea(ctx.db, { projectId: ctx.project.id, userId: ctx.user.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not add the idea."));
  logger.info("content.idea_created", { projectId: ctx.project.id, contentItemId: res.data.id });
  revalidateContent();
  return ok({ id: res.data.id }, "Idea added to IDEA.");
}

/**
 * Kanban move (drag & drop, "Move to…" menu, stage selector). Optimistic-UI
 * friendly: returns ok or the mapped DB refusal (e.g. "Approve the current
 * script before moving to production.") — the client rolls back on failure.
 */
export async function moveContentItem(input: { id: string; stage: string; index?: number }): Promise<ActionResult<MoveResult>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid move.");

  const { id, stage, index } = parsed.data;
  const res = await move(ctx.db, { projectId: ctx.project.id, id, stage, index });
  if (res.error) return fail(errorMessage(res.error, "Could not move the item. Please retry."));
  if (res.data.from !== res.data.stage) {
    logger.info("content.moved", { projectId: ctx.project.id, contentItemId: id, from: res.data.from, to: res.data.stage, userId: ctx.user.id });
  }
  revalidateContent(id);
  return ok(res.data, res.data.from === res.data.stage ? "Order saved." : `Moved to ${STAGE_LABELS[res.data.stage]}.`);
}

export async function updateContentItem(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const id = text(formData, "id");
  if (!uuid.safeParse(id).success) return fail("Invalid content item.");
  const parsed = contentFieldsSchema.safeParse({
    title: text(formData, "title"),
    format: text(formData, "format"),
    description: text(formData, "description"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const res = await updateItem(ctx.db, { projectId: ctx.project.id, id: id!, fields: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not save the changes."));
  revalidateContent(id);
  return ok(undefined, "Saved.");
}

/** Item without a story → a story built from the item, linked to it. */
export async function createStoryForItemAction(contentItemId: string): Promise<ActionResult<{ storyId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(contentItemId).success) return fail("Invalid content item.");

  const res = await createStoryForItem(ctx.db, { projectId: ctx.project.id, id: contentItemId, userId: ctx.user.id });
  if (res.error) return fail(errorMessage(res.error, "Could not create the story."));
  logger.info("content.story_created", {
    projectId: ctx.project.id,
    contentItemId,
    storyId: res.data.storyId,
    existing: res.data.existing,
  });
  revalidateContent(contentItemId);
  return ok({ storyId: res.data.storyId }, res.data.existing ? "This item already has a story." : "Story created and linked.");
}

/**
 * STORY → APPROVAL: a human decision via public.record_approval. Never depends
 * on footage (STORY ≠ FOOTAGE). Every item page showing the story is refreshed.
 */
export async function decideStoryAction(storyId: string, decision: string, notes?: string | null): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = storyDecisionSchema.safeParse({ storyId, decision, notes });
  if (!parsed.success) return fail("Check the decision.", z.flattenError(parsed.error).fieldErrors);

  const res = await decideStory(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not record the decision."));
  logger.info("content.story_decided", { projectId: ctx.project.id, storyId, decision: parsed.data.decision, userId: ctx.user.id });
  revalidatePath("/content");
  revalidatePath("/content/[id]", "page");
  return ok(undefined, parsed.data.decision === "approved" ? "Story approved." : "Story rejected.");
}
