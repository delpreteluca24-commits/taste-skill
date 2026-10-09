import "server-only";

import { cache } from "react";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import { resolveSettings, SETTINGS_SECTIONS, type SettingsSection, type WorkspaceSettings } from "./schema";

/** Workspace-wide settings (project_id is null), defaults merged in. */
export const getWorkspaceSettings = cache(async (): Promise<WorkspaceSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .is("project_id", null)
    .in("key", Object.keys(SETTINGS_SECTIONS));
  if (error) {
    logger.error("settings.read_failed", { code: error.code, message: error.message });
    throw new Error("Could not load settings");
  }

  const stored = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  const { settings, invalidSections } = resolveSettings(stored);
  if (invalidSections.length > 0) {
    logger.warn("settings.invalid_sections_reset_to_defaults", { invalidSections });
  }
  return settings;
});

export async function saveWorkspaceSection<K extends SettingsSection>(
  key: K,
  value: WorkspaceSettings[K],
  userId: string,
) {
  const supabase = await createClient();
  // Partial unique index (key where project_id is null) → no ON CONFLICT target; update-then-insert.
  const { data: updated, error: updateError } = await supabase
    .from("settings")
    .update({ value, updated_by: userId })
    .is("project_id", null)
    .eq("key", key)
    .select("id");
  if (updateError) return { error: updateError };
  if (updated && updated.length > 0) return { error: null };

  const { error } = await supabase.from("settings").insert({ key, value, project_id: null, updated_by: userId });
  return { error };
}
