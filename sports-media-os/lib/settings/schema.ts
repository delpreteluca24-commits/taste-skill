import { z } from "zod";

/**
 * Workspace settings: defaults live here (versioned with the code); the
 * `settings` table stores only overrides, one row per section key.
 * Secrets never belong here — API keys stay in server env.
 */

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

/** Suggestions shown in the UI; any model id is accepted (validated by the provider at call time). */
export const SUGGESTED_MODELS: Record<AIProviderId, readonly string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  openai: [],
};

export const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"] as const;
export const CAPTION_PRESETS = ["clean", "bold", "creator"] as const;
export const ASPECT_RATIOS = ["9:16", "1:1", "4:5", "16:9"] as const;

const modelId = z
  .string()
  .trim()
  .min(1, { message: "Enter a model id" })
  .max(100)
  .regex(/^[A-Za-z0-9._:\-/]+$/, { message: "Invalid model id" });

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS).default("anthropic"),
  model: modelId.default("claude-opus-5-5"),
});

export const transcriptionSettingsSchema = z.object({
  whisperModel: z.enum(WHISPER_MODELS).default("small"),
});

export const productionSettingsSchema = z.object({
  captionPreset: z.enum(CAPTION_PRESETS).default("bold"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("9:16"),
  clipDurationSec: z.coerce.number().int().min(10).max(180).default(45),
});

export const thresholdSettingsSchema = z.object({
  minOpportunityScore: z.coerce.number().min(0).max(100).default(70),
  minViralityScore: z.coerce.number().min(0).max(100).default(60),
});

export const publishingSettingsSchema = z.object({
  // Off by default: publishing is a human checkpoint unless explicitly enabled.
  autoPublish: z.boolean().default(false),
});

export const SETTINGS_SECTIONS = {
  ai: aiSettingsSchema,
  transcription: transcriptionSettingsSchema,
  production: productionSettingsSchema,
  thresholds: thresholdSettingsSchema,
  publishing: publishingSettingsSchema,
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export type WorkspaceSettings = {
  [K in SettingsSection]: z.infer<(typeof SETTINGS_SECTIONS)[K]>;
};

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && Object.hasOwn(SETTINGS_SECTIONS, value);
}

/**
 * Merge stored overrides over defaults. A section whose stored value no longer
 * validates (e.g. after a schema change) falls back to defaults instead of
 * breaking the app; the caller gets the list of invalid sections to log.
 */
export function resolveSettings(stored: Partial<Record<string, unknown>>): {
  settings: WorkspaceSettings;
  invalidSections: SettingsSection[];
} {
  const invalidSections: SettingsSection[] = [];
  const settings = {} as Record<SettingsSection, unknown>;
  for (const key of Object.keys(SETTINGS_SECTIONS) as SettingsSection[]) {
    const schema = SETTINGS_SECTIONS[key];
    const parsed = schema.safeParse(stored[key] ?? {});
    if (parsed.success) {
      settings[key] = parsed.data;
    } else {
      invalidSections.push(key);
      settings[key] = schema.parse({});
    }
  }
  return { settings: settings as WorkspaceSettings, invalidSections };
}
