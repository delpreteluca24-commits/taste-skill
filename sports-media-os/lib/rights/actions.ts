"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { logger } from "@/lib/logger";
import { rescoreHeuristics } from "@/lib/opportunities/service";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import type { EditorialFormat } from "./alternatives";
import { classificationSchema, productionFormatsSchema, registerAssetSchema, rightsDecisionSchema, type ClassifiedStatus } from "./schema";
import { classify, decideRights, registerAsset, setProductionFormats, type ServiceError } from "./service";

/**
 * Rights Center actions. Every action: requireUser → zod → active project →
 * service (RLS client, also filtered by project) → user-safe error → revalidate.
 * Classifications and YELLOW approvals are human decisions; no AI here.
 */

async function activeContext() {
  const user = await requireUser();
  const project = await getActiveProject();
  if (!project) return null;
  return { user, project, db: await createClient() };
}

function errorMessage(error: ServiceError, fallback: string) {
  return error.userMessage ?? toUserMessage(error, fallback);
}

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

/** Rights state is shown in the Rights Center, the research workspace, opportunities (Rights Safety) and content. */
function revalidateRights(asset?: { type: string; id: string }) {
  revalidatePath("/rights");
  if (asset) revalidatePath(`/rights/${asset.type}/${asset.id}`);
  revalidatePath("/research", "layout");
  revalidatePath("/opportunities", "layout");
  revalidatePath("/content", "layout");
}

/**
 * Rights safety in the opportunity score depends on whether the media an
 * opportunity's research relies on is usable: refresh those opportunities after
 * a classification or a YELLOW decision (best effort, bounded).
 */
async function rescoreOpportunitiesUsing(ctx: { db: Awaited<ReturnType<typeof createClient>>; project: { id: string } }, asset: { type: string; id: string }) {
  if (asset.type !== "source") return;
  const { data, error } = await ctx.db
    .from("research_items")
    .select("opportunity_id")
    .eq("project_id", ctx.project.id)
    .eq("source_id", asset.id)
    .not("opportunity_id", "is", null)
    .limit(50);
  if (error) return logger.warn("rights.rescore_lookup_failed", { code: error.code });
  const ids = [...new Set((data ?? []).map((r) => r.opportunity_id).filter((id): id is string => Boolean(id)))].slice(0, 20);
  for (const id of ids) {
    const rescored = await rescoreHeuristics(ctx.db, { projectId: ctx.project.id, id });
    if (rescored.error) logger.warn("rights.rescore_failed", { opportunityId: id, code: rescored.error.code });
  }
}

const STATUS_LABEL: Record<ClassifiedStatus, string> = { green: "GREEN", yellow: "YELLOW", red: "RED" };

/** Record a GREEN / YELLOW / RED classification (a new rights check) for an asset of the active project. */
export async function classifyAsset(
  _prev: ActionResult<{ checkId: string; status: ClassifiedStatus }> | null,
  formData: FormData,
): Promise<ActionResult<{ checkId: string; status: ClassifiedStatus }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = classificationSchema.safeParse({
    assetType: text(formData, "assetType"),
    assetId: text(formData, "assetId"),
    status: text(formData, "status"),
    ownership: text(formData, "ownership"),
    owner: text(formData, "owner"),
    sourceDetail: text(formData, "sourceDetail"),
    license: text(formData, "license"),
    commercialUse: text(formData, "commercialUse") ?? "unknown",
    authorization: text(formData, "authorization"),
    transformationRequired: text(formData, "transformationRequired"),
    risk: text(formData, "risk"),
    evidenceUrl: text(formData, "evidenceUrl"),
    notes: text(formData, "notes"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const { assetType, assetId, ...fields } = parsed.data;
  const res = await classify(ctx.db, { projectId: ctx.project.id, assetType, assetId, fields });
  if (res.error) return fail(errorMessage(res.error, "Could not record the classification."));

  logger.info("rights.classified", {
    projectId: ctx.project.id,
    assetType,
    assetId,
    checkId: res.data.checkId,
    status: res.data.status,
    usable: res.data.usable,
    userId: ctx.user.id,
  });
  await rescoreOpportunitiesUsing(ctx, { type: assetType, id: assetId });
  revalidateRights({ type: assetType, id: assetId });
  const label = STATUS_LABEL[res.data.status];
  return ok(
    { checkId: res.data.checkId, status: res.data.status },
    res.data.status === "green"
      ? "Classified GREEN: usable in production under the recorded conditions."
      : res.data.status === "yellow"
        ? `Classified ${label}: not usable until a person approves its use below.`
        : `Classified ${label}: this asset never enters production. Tell the story with original formats.`,
  );
}

/** Register an external asset link; reuses the existing source for the same link. Opens the asset to classify it. */
export async function registerAssetAction(
  _prev: ActionResult<{ sourceId: string; existing: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ sourceId: string; existing: boolean }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = registerAssetSchema.safeParse({
    url: text(formData, "url"),
    title: text(formData, "title"),
    publisher: text(formData, "publisher"),
    kind: text(formData, "kind"),
  });
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  const res = await registerAsset(ctx.db, { projectId: ctx.project.id, input: parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not register the asset."));
  logger.info("rights.asset_registered", {
    projectId: ctx.project.id,
    sourceId: res.data.sourceId,
    existing: res.data.existing,
    kind: parsed.data.kind,
  });
  revalidateRights();
  redirect(`/rights/source/${res.data.sourceId}${res.data.existing ? "?existing=1" : ""}`);
}

/** RIGHTS → APPROVAL for the latest YELLOW classification of an asset (a person decides, with notes). */
export async function decideRightsAction(checkId: string, decision: string, notes?: string | null): Promise<ActionResult> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = rightsDecisionSchema.safeParse({ checkId, decision, notes });
  if (!parsed.success) return fail("Check the decision.", z.flattenError(parsed.error).fieldErrors);

  const res = await decideRights(ctx.db, { projectId: ctx.project.id, ...parsed.data });
  if (res.error) return fail(errorMessage(res.error, "Could not record the decision."));
  logger.info("rights.decided", {
    projectId: ctx.project.id,
    checkId,
    decision: parsed.data.decision,
    usable: res.data.usable,
    userId: ctx.user.id,
  });
  await rescoreOpportunitiesUsing(ctx, { type: res.data.assetType, id: res.data.assetId });
  revalidateRights({ type: res.data.assetType, id: res.data.assetId });
  return ok(
    undefined,
    parsed.data.decision === "approved"
      ? "Approved for human-initiated production. Automated workflows still can't use YELLOW assets."
      : "Rejected: the asset is not usable in production.",
  );
}

/**
 * CONTRACT (STORY ≠ FOOTAGE): save the production plan of a story of the
 * active project (stories.production_formats).
 */
export async function saveProductionFormats(storyId: string, formats: string[]): Promise<ActionResult<{ formats: EditorialFormat[] }>> {
  const ctx = await activeContext();
  if (!ctx) return fail("Create or select a project first.");
  const parsed = productionFormatsSchema.safeParse({ storyId, formats });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid production formats.");

  const res = await setProductionFormats(ctx.db, { projectId: ctx.project.id, storyId: parsed.data.storyId, formats: parsed.data.formats });
  if (res.error) return fail(errorMessage(res.error, "Could not save the production formats."));
  logger.info("rights.production_formats_saved", { projectId: ctx.project.id, storyId, count: res.data.formats.length });
  // Rights safety in the opportunity score depends on the chosen formats (best effort)
  if (res.data.opportunityId) {
    const rescored = await rescoreHeuristics(ctx.db, { projectId: ctx.project.id, id: res.data.opportunityId });
    if (rescored.error) logger.warn("rights.rescore_failed", { opportunityId: res.data.opportunityId, code: rescored.error.code });
  }
  revalidatePath("/content", "layout");
  revalidatePath("/opportunities", "layout");
  return ok(
    { formats: res.data.formats },
    res.data.formats.length ? "Production plan saved." : "Production plan cleared.",
  );
}
