"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { resolveTaskConfig } from "@/lib/ai/models";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { getActiveProject } from "@/lib/projects/service";
import { getWorkspaceSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

import { decideBatchCost, estimateRequestsCost, type BatchCostEstimate } from "./ai-cost";
import { buildScoringRequest } from "./ai-scoring";
import {
  aiScoringRequestSchema,
  componentScoreSchema,
  decisionSchema,
  manualOpportunitySchema,
  opportunityFieldsSchema,
} from "./schema";
import { isComponentKey } from "./scoring";
import {
  createFromTrend,
  createManual,
  decideOpportunity as recordDecision,
  loadScoringBatch,
  rescoreHeuristics,
  resetComponent,
  setComponent,
  startProduction,
  updateFields,
  type ServiceError,
} from "./service";

/**
 * Opportunity actions. Every action: requireUser → zod → active project →
 * service (RLS client, also filtered by project) → user-safe error → revalidate.
 * No AI here: AI scoring is enqueued as a background job after a cost check.
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

function revalidateOpportunity(id?: string) {
  revalidatePath("/opportunities");
  if (id) revalidatePath(`/opportunities/${id}`);
  revalidatePath("/dashboard");
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

/**
 * CONTRACT (used by Trends/Radar): create a scored opportunity from a trend
 * (heuristic components + explanation). Returns the open one if it already exists.
 */
export async function createOpportunityFromTrendAction(trendId: string): Promise<ActionResult<{ opportunityId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(trendId).success) return fail("Invalid trend.");

  const res = await createFromTrend(ctx.db, { projectId: ctx.project.id, trendId, userId: ctx.user.id });
  if (res.error) return fail(errorMessage(res.error, "Could not create the opportunity."));

  logger.info("opportunities.created_from_trend", {
    projectId: ctx.project.id,
    opportunityId: res.data.id,
    existing: res.data.existing,
    researchItems: res.data.researchItems,
  });
  revalidateOpportunity(res.data.id);
  revalidatePath("/trends");
  return ok(
    { opportunityId: res.data.id },
    res.data.existing ? "An open opportunity for this trend already exists." : "Opportunity created with an explained heuristic score.",
  );
}

export async function createManualOpportunity(
  _prev: ActionResult<{ opportunityId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ opportunityId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = manualOpportunitySchema.safeParse({
    title: text(formData, "title"),
    description: text(formData, "description"),
    why_now: text(formData, "why_now"),
    angle: text(formData, "angle"),
    hook: text(formData, "hook"),
    competition: text(formData, "competition"),
    sportId: text(formData, "sportId"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const res = await createManual(ctx.db, { projectId: ctx.project.id, userId: ctx.user.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not create the opportunity."));
  logger.info("opportunities.created_manual", { projectId: ctx.project.id, opportunityId: res.data.id });
  revalidateOpportunity(res.data.id);
  redirect(`/opportunities/${res.data.id}`);
}

export async function updateOpportunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const id = text(formData, "id");
  if (!uuid.safeParse(id).success) return fail("Invalid opportunity.");
  const parsed = opportunityFieldsSchema.safeParse({
    title: text(formData, "title"),
    description: text(formData, "description"),
    why_now: text(formData, "why_now"),
    angle: text(formData, "angle"),
    hook: text(formData, "hook"),
    competition: text(formData, "competition"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const res = await updateFields(ctx.db, { projectId: ctx.project.id, id: id!, fields: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not save the changes."));
  revalidateOpportunity(id);
  return ok(undefined, "Saved. Heuristic components were recomputed.");
}

/** Manual override of one component (0–100) with a reason. */
export async function setComponentScore(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = componentScoreSchema.safeParse({
    id: text(formData, "id"),
    component: text(formData, "component"),
    value: text(formData, "value"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const { id, component, value, reason } = parsed.data;
  const res = await setComponent(ctx.db, { projectId: ctx.project.id, id, component, value, reason });
  if (res.error) return fail(errorMessage(res.error, "Could not save the override."));
  logger.info("opportunities.component_overridden", { projectId: ctx.project.id, opportunityId: id, component });
  revalidateOpportunity(id);
  return ok(undefined, "Override saved and score recomputed.");
}

/** Remove a manual/AI value: the component returns to its heuristic estimate. */
export async function resetComponentScore(opportunityId: string, component: string): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(opportunityId).success || !isComponentKey(component)) return fail("Invalid request.");
  const res = await resetComponent(ctx.db, { projectId: ctx.project.id, id: opportunityId, component });
  if (res.error) return fail(errorMessage(res.error, "Could not reset the component."));
  revalidateOpportunity(opportunityId);
  return ok(undefined, "Back to the heuristic estimate.");
}

/** Recompute heuristic components (research, rights, timing changed). AI/manual values stay. */
export async function rescore(opportunityId: string): Promise<ActionResult<{ score: number | null }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");
  const res = await rescoreHeuristics(ctx.db, { projectId: ctx.project.id, id: opportunityId });
  if (res.error) return fail(errorMessage(res.error, "Could not recompute the score."));
  revalidateOpportunity(opportunityId);
  return ok({ score: res.data.score }, "Heuristics recomputed.");
}

export type AIScoringRequestResult =
  | { status: "queued"; jobId: string; deduplicated: boolean; estimate: BatchCostEstimate }
  | { status: "needs_confirmation"; reason: "above_limit" | "unpriced" | "estimate_changed"; estimate: BatchCostEstimate };

/**
 * AI scoring (SCORING task) as a background job. The cost of the batch is
 * estimated first; above Settings → AI → batch cost limit (or for an unpriced
 * model) it returns the estimate and waits for the user to confirm it.
 */
export async function requestAIScoring(ids: string[], confirmedCostUsd?: number): Promise<ActionResult<AIScoringRequestResult>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = aiScoringRequestSchema.safeParse({ ids, confirmedCostUsd });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid selection.");
  const unique = [...new Set(parsed.data.ids)];

  const batch = await loadScoringBatch(ctx.db, ctx.project.id, unique);
  if (batch.error) return fail(errorMessage(batch.error, "Could not load the selection."));
  if (batch.data.missing.length) return fail("Some selected opportunities are not in this project anymore. Refresh and retry.");

  const requests = batch.data.rows
    .map((row) => buildScoringRequest(row, batch.data.contexts.get(row.id) ?? { sportName: null, sources: [] }))
    .filter((r) => r.input.doNotScore.length < 4)
    .map((r) => r.request);
  if (requests.length === 0) return fail("Every AI-scored component of the selection was set manually: nothing to score.");

  const settings = await getWorkspaceSettings();
  const config = resolveTaskConfig("scoring", settings.ai.tasks.scoring);
  const estimate = estimateRequestsCost(requests, config, settings.ai.batchCostLimitUsd);
  const decision = decideBatchCost(estimate, parsed.data.confirmedCostUsd);
  if (!decision.allowed) return ok({ status: "needs_confirmation", reason: decision.reason, estimate });

  const key = createHash("sha256").update([...unique].sort().join(",")).digest("hex").slice(0, 32);
  const job = await enqueueJob(ctx.db, {
    projectId: ctx.project.id,
    type: "opportunity.ai_score",
    payload: { opportunityIds: unique, ...(decision.confirmed ? { confirmedCostUsd: parsed.data.confirmedCostUsd } : {}) },
    userId: ctx.user.id,
    idempotencyKey: `opportunity.ai_score:${ctx.project.id}:${key}`,
  });
  if (!job.ok) {
    logger.error("opportunities.ai_scoring_enqueue_failed", { projectId: ctx.project.id, code: job.code, message: job.error });
    return fail(toUserMessage({ code: job.code, message: job.error }, "Could not queue AI scoring."));
  }
  logger.info("opportunities.ai_scoring_queued", {
    projectId: ctx.project.id,
    jobId: job.jobId,
    count: unique.length,
    model: estimate.model,
    estimateUsd: estimate.usd,
    confirmed: decision.confirmed,
  });
  return ok({ status: "queued", jobId: job.jobId, deduplicated: job.deduplicated, estimate });
}

/** OPPORTUNITY → APPROVAL: a human decision via public.record_approval. */
export async function decideOpportunity(id: string, decision: string, notes?: string | null): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = decisionSchema.safeParse({ id, decision, notes });
  if (!parsed.success) return fail("Check the decision.", z.flattenError(parsed.error).fieldErrors);

  const res = await recordDecision(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not record the decision."));
  logger.info("opportunities.decided", { projectId: ctx.project.id, opportunityId: id, decision: parsed.data.decision, userId: ctx.user.id });
  revalidateOpportunity(id);
  return ok(undefined, parsed.data.decision === "approved" ? "Approved. You can start production." : "Rejected.");
}

/**
 * CONTRACT: for an APPROVED opportunity create story + content item (stage
 * "research"), set the opportunity to production, then go to /content/[id].
 */
export async function startProductionAction(opportunityId: string): Promise<ActionResult<{ contentItemId: string }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  if (!uuid.safeParse(opportunityId).success) return fail("Invalid opportunity.");

  const res = await startProduction(ctx.db, { projectId: ctx.project.id, id: opportunityId, userId: ctx.user.id });
  if (res.error) return fail(errorMessage(res.error, "Could not start production."));
  logger.info("opportunities.production_started", {
    projectId: ctx.project.id,
    opportunityId,
    contentItemId: res.data.contentItemId,
    existing: res.data.existing,
  });
  revalidateOpportunity(opportunityId);
  revalidatePath("/content");
  redirect(`/content/${res.data.contentItemId}`);
}
