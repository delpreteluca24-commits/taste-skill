"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/auth/dal";
import { toUserMessage } from "@/lib/db/errors";
import { logger } from "@/lib/logger";
import { isSettingsSection, SETTINGS_SECTIONS } from "@/lib/settings/schema";
import { saveWorkspaceSection } from "@/lib/settings/service";

/** Reads the raw form values for one section (checkboxes → booleans). */
function readSection(section: string, formData: FormData): Record<string, unknown> {
  switch (section) {
    case "ai":
      return { provider: formData.get("provider"), model: formData.get("model") };
    case "transcription":
      return { whisperModel: formData.get("whisperModel") };
    case "production":
      return {
        captionPreset: formData.get("captionPreset"),
        aspectRatio: formData.get("aspectRatio"),
        clipDurationSec: formData.get("clipDurationSec"),
      };
    case "thresholds":
      return {
        minOpportunityScore: formData.get("minOpportunityScore"),
        minViralityScore: formData.get("minViralityScore"),
      };
    case "publishing":
      return { autoPublish: formData.get("autoPublish") === "on" };
    default:
      return {};
  }
}

export async function saveSettingsSection(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "member") return fail("Only workspace admins can change workspace settings.");

  const section = formData.get("section");
  if (!isSettingsSection(section)) return fail("Unknown settings section.");

  const schema = SETTINGS_SECTIONS[section] as z.ZodType<Record<string, unknown>>;
  const parsed = schema.safeParse(readSection(section, formData));
  if (!parsed.success) {
    return fail("Check the highlighted fields.", z.flattenError(parsed.error).fieldErrors);
  }

  const { error } = await saveWorkspaceSection(section, parsed.data as never, user.id);
  if (error) {
    logger.error("settings.save_failed", { section, code: error.code, message: error.message });
    return fail(toUserMessage(error, "Could not save settings."));
  }

  logger.info("settings.saved", { section, userId: user.id });
  revalidatePath("/settings");
  return ok(undefined, "Saved.");
}
