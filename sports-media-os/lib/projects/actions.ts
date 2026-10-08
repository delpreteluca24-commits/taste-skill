"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fail, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { logger } from "@/lib/logger";

import { createProjectSchema } from "./schema";
import { createProject, listProjects, setActiveProjectCookie } from "./service";

export async function switchProject(projectId: string): Promise<void> {
  await requireUser();
  const parsed = z.uuid().safeParse(projectId);
  if (!parsed.success) return;
  // only projects the user can see (RLS) are selectable
  const projects = await listProjects();
  if (!projects.some((p) => p.id === parsed.data)) return;
  await setActiveProjectCookie(parsed.data);
  revalidatePath("/", "layout");
}

export async function createProjectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    primarySportId: formData.get("primarySportId"),
    language: formData.get("language") || undefined,
    timezone: formData.get("timezone") || undefined,
  });
  if (!parsed.success) {
    return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);
  }

  const { data, error } = await createProject(user.id, parsed.data);
  if (error || !data) {
    logger.error("projects.create_failed", { code: error?.code, message: error?.message, userId: user.id });
    return fail(toUserMessage(error, "Could not create the project."));
  }

  logger.info("projects.created", { projectId: data.id, userId: user.id });
  await setActiveProjectCookie(data.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
