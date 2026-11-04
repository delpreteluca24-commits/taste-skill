"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage, type DbErrorLike } from "@/lib/db/errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { logger } from "@/lib/logger";
import { currentNetworkPolicy, validateFetchUrl } from "@/lib/net/address";
import { getActiveProject } from "@/lib/projects/service";
import { createClient } from "@/lib/supabase/server";

import { connectorFormSchema, readConnectorForm } from "./schema";
import { createConnector, deleteConnector, getConnector, listActiveFetchJobs, setConnectorEnabled, updateConnector } from "./service";

const CONNECTORS_PATH = "/radar/connectors";
const idSchema = z.uuid();

function connectorError(error: DbErrorLike, fallback: string): string {
  if (error?.code === "23505") return "A connector for this URL already exists in this project.";
  return toUserMessage(error, fallback);
}

async function context() {
  const user = await requireUser();
  const project = await getActiveProject();
  return { user, project, supabase: await createClient() };
}

/** Create (no id) or update (hidden `id`) a connector. Redirects to the list on success. */
export async function saveConnectorAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { user, project, supabase } = await context();
  if (!project) return fail("Create a project first.");

  const rawId = formData.get("id");
  const id = typeof rawId === "string" && rawId ? rawId : null;
  if (id && !idSchema.safeParse(id).success) return fail("Invalid connector.");

  const parsed = connectorFormSchema.safeParse(readConnectorForm(formData));
  if (!parsed.success) return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);

  // SSRF policy at save time too (the worker re-checks every fetch, incl. DNS at connect time)
  const urlCheck = validateFetchUrl(parsed.data.url, currentNetworkPolicy());
  if (!urlCheck.ok) return fail("Check the highlighted fields.", { url: [urlCheck.reason] });

  const result = id
    ? await updateConnector(supabase, project.id, id, parsed.data)
    : await createConnector(supabase, project.id, user.id, parsed.data);
  if (result.error) {
    logger.warn("connectors.save_failed", { projectId: project.id, code: result.error.code, message: result.error.message });
    return fail(connectorError(result.error, "Could not save the connector."));
  }

  logger.info(id ? "connectors.updated" : "connectors.created", { projectId: project.id, connectorId: result.data.id, userId: user.id });
  revalidatePath(CONNECTORS_PATH);
  redirect(CONNECTORS_PATH);
}

export async function setConnectorEnabledAction(connectorId: string, enabled: boolean): Promise<ActionResult> {
  const { user, project, supabase } = await context();
  if (!project) return fail("Create a project first.");
  if (!idSchema.safeParse(connectorId).success || typeof enabled !== "boolean") return fail("Invalid connector.");

  const { error } = await setConnectorEnabled(supabase, project.id, connectorId, enabled);
  if (error) return fail(connectorError(error, "Could not update the connector."));
  logger.info("connectors.toggled", { projectId: project.id, connectorId, enabled, userId: user.id });
  revalidatePath(CONNECTORS_PATH);
  return ok(undefined, enabled ? "Enabled." : "Disabled.");
}

export async function deleteConnectorAction(connectorId: string): Promise<ActionResult> {
  const { user, project, supabase } = await context();
  if (!project) return fail("Create a project first.");
  if (!idSchema.safeParse(connectorId).success) return fail("Invalid connector.");

  const { error } = await deleteConnector(supabase, project.id, connectorId);
  if (error) return fail(connectorError(error, "Could not delete the connector."));
  logger.info("connectors.deleted", { projectId: project.id, connectorId, userId: user.id });
  revalidatePath(CONNECTORS_PATH);
  return ok(undefined, "Connector deleted. Sources it already collected are kept.");
}

/**
 * "Fetch now": never fetches in the request — queues connector.fetch for the
 * worker and returns the job id for <JobStatus>. A fetch already queued or
 * running for this connector is reused (double clicks, scheduled run).
 */
export async function fetchConnectorNowAction(connectorId: string): Promise<ActionResult<{ jobId: string; deduplicated: boolean }>> {
  const { user, project, supabase } = await context();
  if (!project) return fail("Create a project first.");
  if (!idSchema.safeParse(connectorId).success) return fail("Invalid connector.");

  const connector = await getConnector(supabase, project.id, connectorId);
  if (!connector) return fail("Not found or you don't have access.");

  const active = (await listActiveFetchJobs(supabase, project.id))[connectorId];
  if (active) return ok({ jobId: active, deduplicated: true }, "Already queued.");

  const minuteSlot = Math.floor(Date.now() / 60_000);
  const result = await enqueueJob(supabase, {
    projectId: project.id,
    type: "connector.fetch",
    payload: { connectorId },
    userId: user.id,
    idempotencyKey: `connector.fetch:${connectorId}:manual:${minuteSlot}`,
    priority: 60,
  });
  if (!result.ok) {
    logger.warn("connectors.fetch_enqueue_failed", { projectId: project.id, connectorId, code: result.code, message: result.error });
    return fail(toUserMessage({ code: result.code, message: result.error }, "Could not queue the fetch."));
  }
  logger.info("connectors.fetch_queued", { projectId: project.id, connectorId, jobId: result.jobId, userId: user.id });
  return ok({ jobId: result.jobId, deduplicated: result.deduplicated }, "Queued.");
}
