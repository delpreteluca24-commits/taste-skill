"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { suggestionStaleReason } from "@/lib/factcheck/sanitize";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import {
  answerQuestionSchema,
  claimFormSchema,
  claimStatusSchema,
  CLAIM_RELATIONS,
  linkSourceSchema,
  researchItemSchema,
  sourceFormSchema,
} from "./schema";
import {
  addSource,
  answerQuestion,
  createClaim,
  createItem,
  deleteClaim,
  deleteItem,
  findActiveJob,
  getOpportunityRef,
  linkClaimSource,
  loadClaimEvidence,
  setClaimStatus,
  setLinkRelation,
  unlinkClaimSource,
  updateClaim,
  updateItem,
  type ServiceError,
} from "./service";

/**
 * Research Workspace actions. Every action: requireUser → zod → active project
 * → service (RLS client, also filtered by project) → user-safe error → revalidate.
 * No AI here: "AI: suggest research" and "AI: assist fact check" enqueue
 * background jobs and return the job id for <JobStatus>.
 */

const uuid = z.uuid();

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

function errorMessage(error: ServiceError, fallback: string) {
  if (error.userMessage) return error.userMessage;
  if (error.code === "42501") return "You don't have permission to do this. Deleting research needs a project admin.";
  return toUserMessage(error, fallback);
}

function revalidateWorkspace(opportunityId?: string | null) {
  revalidatePath("/research");
  if (opportunityId) {
    revalidatePath(`/research/${opportunityId}`);
    // the opportunity page shows research counts
    revalidatePath(`/opportunities/${opportunityId}`);
  }
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};
const checked = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return v === "on" || v === "true";
};

type Fields = Record<string, string[] | undefined>;
const invalidForm = (error: z.ZodError) => fail("Check the highlighted fields.", z.flattenError(error).fieldErrors as Fields);

/* ------------------------------------------------------------------------- */
/* sources                                                                   */
/* ------------------------------------------------------------------------- */

export async function addSourceAction(
  _prev: ActionResult<{ sourceId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ sourceId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const opportunityId = text(formData, "opportunityId");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
  const parsed = sourceFormSchema.safeParse({
    url: text(formData, "url"),
    publisher: text(formData, "publisher"),
    title: text(formData, "title"),
    type: text(formData, "type") || undefined,
    summary: text(formData, "summary"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await addSource(ctx.db, { projectId: ctx.project.id, opportunityId: opportunityId!, userId: ctx.user.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not add the source."));
  logger.info("research.source_added", {
    projectId: ctx.project.id,
    opportunityId,
    sourceId: res.data.sourceId,
    existingSource: res.data.existingSource,
  });
  revalidateWorkspace(opportunityId);
  const message = res.data.alreadyLinked
    ? "This source is already in the workspace."
    : res.data.existingSource
      ? "Linked an existing project source (same link). Its rights classification carries over."
      : "Source added. Rights start as unchecked: classify it in the Rights Center before using it as material.";
  return ok({ sourceId: res.data.sourceId }, message);
}

/* ------------------------------------------------------------------------- */
/* research items                                                            */
/* ------------------------------------------------------------------------- */

function readItemForm(formData: FormData) {
  return {
    type: text(formData, "type"),
    title: text(formData, "title"),
    url: text(formData, "url"),
    sourceId: text(formData, "sourceId"),
    content: text(formData, "content"),
    publishedAt: text(formData, "publishedAt"),
    mediaKind: text(formData, "mediaKind"),
    speaker: text(formData, "speaker"),
    saidAt: text(formData, "saidAt"),
    occurredAt: text(formData, "occurredAt"),
    answered: checked(formData, "answered"),
    answer: text(formData, "answer"),
    channel: text(formData, "channel"),
    platform: text(formData, "platform"),
    views: text(formData, "views"),
  };
}

export async function createItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const opportunityId = text(formData, "opportunityId");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
  const parsed = researchItemSchema.safeParse(readItemForm(formData));
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await createItem(ctx.db, { projectId: ctx.project.id, opportunityId: opportunityId!, userId: ctx.user.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not add it."));
  logger.info("research.item_created", { projectId: ctx.project.id, opportunityId, itemId: res.data.id, type: parsed.data.type });
  revalidateWorkspace(opportunityId);
  return ok(undefined, "Added.");
}

export async function updateItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const itemId = text(formData, "itemId");
  if (!uuid.safeParse(itemId).success) return fail("Invalid item.");
  const parsed = researchItemSchema.safeParse(readItemForm(formData));
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await updateItem(ctx.db, { projectId: ctx.project.id, itemId: itemId!, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not save the changes."));
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Saved.");
}

export async function deleteItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const itemId = text(formData, "itemId");
  if (!uuid.safeParse(itemId).success) return fail("Invalid item.");

  const res = await deleteItem(ctx.db, { projectId: ctx.project.id, itemId: itemId! });
  if (res.error) return fail(errorMessage(res.error, "Could not delete it."));
  logger.info("research.item_deleted", { projectId: ctx.project.id, itemId });
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Deleted.");
}

export async function answerQuestionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = answerQuestionSchema.safeParse({
    itemId: text(formData, "itemId"),
    answered: text(formData, "answered") === "true",
    answer: text(formData, "answer"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await answerQuestion(ctx.db, {
    projectId: ctx.project.id,
    itemId: parsed.data.itemId,
    answered: parsed.data.answered,
    answer: parsed.data.answer,
    userId: ctx.user.id,
  });
  if (res.error) return fail(errorMessage(res.error, "Could not save the answer."));
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, parsed.data.answered ? "Marked answered." : "Question reopened.");
}

/* ------------------------------------------------------------------------- */
/* claims                                                                    */
/* ------------------------------------------------------------------------- */

export async function createClaimAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const opportunityId = text(formData, "opportunityId");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
  const parsed = claimFormSchema.safeParse({ claim: text(formData, "claim"), isCritical: checked(formData, "isCritical") });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await createClaim(ctx.db, {
    projectId: ctx.project.id,
    opportunityId: opportunityId!,
    claim: parsed.data.claim,
    isCritical: parsed.data.isCritical,
  });
  if (res.error) return fail(errorMessage(res.error, "Could not add the claim."));
  logger.info("research.claim_created", { projectId: ctx.project.id, opportunityId, factId: res.data.id, critical: parsed.data.isCritical });
  revalidateWorkspace(opportunityId);
  return ok(undefined, "Claim added as Uncertain. Link its sources, then verify it.");
}

export async function updateClaimAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const factId = text(formData, "factId");
  if (!uuid.safeParse(factId).success) return fail("Invalid claim.");
  const parsed = claimFormSchema.safeParse({ claim: text(formData, "claim"), isCritical: checked(formData, "isCritical") });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await updateClaim(ctx.db, {
    projectId: ctx.project.id,
    factId: factId!,
    claim: parsed.data.claim,
    isCritical: parsed.data.isCritical,
  });
  if (res.error) return fail(errorMessage(res.error, "Could not save the claim."));
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, res.data.statusReset ? "Saved. The wording changed, so the status was reset to Uncertain." : "Saved.");
}

export async function deleteClaimAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const factId = text(formData, "factId");
  if (!uuid.safeParse(factId).success) return fail("Invalid claim.");
  const res = await deleteClaim(ctx.db, { projectId: ctx.project.id, factId: factId! });
  if (res.error) return fail(errorMessage(res.error, "Could not delete the claim."));
  logger.info("research.claim_deleted", { projectId: ctx.project.id, factId });
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Claim deleted.");
}

/**
 * Link a workspace source to a claim with its relation, excerpt and locator.
 * A new link can be pasted instead of picking a source: it is added to the
 * workspace first (same dedupe as "Add source").
 */
export async function linkClaimSourceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  let sourceId = text(formData, "sourceId");
  const newUrl = text(formData, "newUrl")?.trim();
  const opportunityId = text(formData, "opportunityId");

  if (!sourceId && newUrl) {
    if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
    const source = sourceFormSchema.safeParse({ url: newUrl, type: "news" });
    if (!source.success) return fail("Check the highlighted fields.", { newUrl: z.flattenError(source.error).fieldErrors.url });
    const added = await addSource(ctx.db, { projectId: ctx.project.id, opportunityId: opportunityId!, userId: ctx.user.id, input: source.data });
    if (added.error) return fail(errorMessage(added.error, "Could not add the source."));
    sourceId = added.data.sourceId;
  }

  const parsed = linkSourceSchema.safeParse({
    factId: text(formData, "factId"),
    sourceId,
    relation: text(formData, "relation") || undefined,
    excerpt: text(formData, "excerpt"),
    locator: text(formData, "locator"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await linkClaimSource(ctx.db, { projectId: ctx.project.id, userId: ctx.user.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not link the source."));
  revalidateWorkspace(res.data.opportunityId ?? opportunityId);
  return ok(undefined, res.data.updated ? "Link updated." : "Source linked.");
}

export async function unlinkClaimSourceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const factId = text(formData, "factId");
  const sourceId = text(formData, "sourceId");
  if (!uuid.safeParse(factId).success || !uuid.safeParse(sourceId).success) return fail("Invalid link.");

  const res = await unlinkClaimSource(ctx.db, { projectId: ctx.project.id, factId: factId!, sourceId: sourceId! });
  if (res.error) return fail(errorMessage(res.error, "Could not unlink the source."));
  revalidateWorkspace(res.data.opportunityId);
  return ok(
    undefined,
    res.data.downgraded ? "Unlinked. That was the last supporting source, so the claim went back to Uncertain." : "Unlinked.",
  );
}

/** One-click relation change (e.g. applying the AI's per-source suggestion — a person still clicks). */
export async function setLinkRelationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = z
    .object({ factId: z.uuid(), sourceId: z.uuid(), relation: z.enum(CLAIM_RELATIONS) })
    .safeParse({ factId: text(formData, "factId"), sourceId: text(formData, "sourceId"), relation: text(formData, "relation") });
  if (!parsed.success) return fail("Invalid link.");

  const res = await setLinkRelation(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not change the relation."));
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Relation updated.");
}

/** Human verification: status + confidence + notes (DB stamps who and when; CLAIM_UNSOURCED applies). */
export async function setClaimStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = claimStatusSchema.safeParse({
    factId: text(formData, "factId"),
    status: text(formData, "status"),
    confidence: text(formData, "confidence"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return invalidForm(parsed.error);

  const res = await setClaimStatus(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not update the status."));
  logger.info("research.claim_status_set", { projectId: ctx.project.id, factId: parsed.data.factId, status: parsed.data.status });
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Status updated.");
}

/**
 * Apply the stored AI assessment with one click — through the same status
 * update and DB rules as a manual change. Refused when the claim or its linked
 * sources changed since the assessment.
 */
export async function applyClaimSuggestionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const factId = text(formData, "factId");
  if (!uuid.safeParse(factId).success) return fail("Invalid claim.");

  const evidence = await loadClaimEvidence(ctx.db, ctx.project.id, factId!);
  if (evidence.error) return fail(errorMessage(evidence.error, "Could not load the claim."));
  const { fact, aiSuggestion, sources } = evidence.data;
  if (!aiSuggestion) return fail("There is no AI suggestion to apply.");
  const stale = suggestionStaleReason(aiSuggestion, { claim: fact.claim, sourceIds: sources.map((s) => s.id) });
  if (stale) return fail(`${stale} Ask the AI to assess it again, or set the status yourself.`);

  const day = aiSuggestion.at.slice(0, 10);
  const res = await setClaimStatus(ctx.db, {
    projectId: ctx.project.id,
    factId: fact.id,
    status: aiSuggestion.suggestedStatus,
    confidence: aiSuggestion.confidence,
    notes: fact.notes ?? `Applied the AI fact-check suggestion (${aiSuggestion.model}, ${day}) after review.`,
  });
  if (res.error) return fail(errorMessage(res.error, "Could not apply the suggestion."));
  logger.info("research.claim_suggestion_applied", { projectId: ctx.project.id, factId: fact.id, status: aiSuggestion.suggestedStatus });
  revalidateWorkspace(res.data.opportunityId);
  return ok(undefined, "Suggestion applied.");
}

/* ------------------------------------------------------------------------- */
/* AI (background jobs only)                                                 */
/* ------------------------------------------------------------------------- */

export type QueuedJob = { jobId: string; deduplicated: boolean };

function enqueueError(code: string | undefined) {
  return code === "42501" ? "Only editors of this project can ask the AI." : "Could not queue the AI job. Please retry.";
}

/** "AI: suggest research" → research.suggest job (RESEARCH task model, agent 'researcher'). */
export async function requestResearchSuggestionsAction(opportunityId: string): Promise<ActionResult<QueuedJob>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
  const opp = await getOpportunityRef(ctx.db, ctx.project.id, opportunityId);
  if (opp.error) return fail(errorMessage(opp.error, "Could not find the opportunity."));

  const active = await findActiveJob(ctx.db, ctx.project.id, "research.suggest", "opportunityId", opportunityId);
  if (active) return ok({ jobId: active, deduplicated: true }, "AI research suggestions are already running.");

  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "research.suggest",
    payload: { opportunityId },
    userId: ctx.user.id,
    idempotencyKey: `research.suggest:${opportunityId}`,
  });
  if (!res.ok) {
    logger.warn("research.suggest_enqueue_failed", { projectId: ctx.project.id, opportunityId, code: res.code });
    return fail(enqueueError(res.code));
  }
  logger.info("research.suggest_enqueued", { projectId: ctx.project.id, opportunityId, jobId: res.jobId });
  return ok({ jobId: res.jobId, deduplicated: res.deduplicated });
}

/** "Ask AI to assess" → factcheck.assist job (FACT_CHECK task model, agent 'fact_checker'). */
export async function requestFactCheckAction(factId: string): Promise<ActionResult<QueuedJob>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(factId).success) return fail("Invalid claim.");
  const evidence = await loadClaimEvidence(ctx.db, ctx.project.id, factId);
  if (evidence.error) return fail(errorMessage(evidence.error, "Could not load the claim."));
  if (evidence.data.sources.length === 0) return fail("Link at least one source to this claim first: the AI only assesses linked sources.");

  const active = await findActiveJob(ctx.db, ctx.project.id, "factcheck.assist", "factId", factId);
  if (active) return ok({ jobId: active, deduplicated: true }, "An assessment is already running.");

  const res = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "factcheck.assist",
    payload: { factId },
    userId: ctx.user.id,
    idempotencyKey: `factcheck.assist:${factId}`,
  });
  if (!res.ok) {
    logger.warn("research.factcheck_enqueue_failed", { projectId: ctx.project.id, factId, code: res.code });
    return fail(enqueueError(res.code));
  }
  logger.info("research.factcheck_enqueued", { projectId: ctx.project.id, factId, jobId: res.jobId });
  return ok({ jobId: res.jobId, deduplicated: res.deduplicated });
}
