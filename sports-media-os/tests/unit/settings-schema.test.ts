import { describe, expect, it } from "vitest";

import { aiSettingsSchema, isSettingsSection, productionSettingsSchema, resolveSettings } from "@/lib/settings/schema";

describe("resolveSettings", () => {
  it("returns safe defaults when nothing is stored", () => {
    const { settings, invalidSections } = resolveSettings({});
    expect(invalidSections).toEqual([]);
    // per-task routing: nothing stored = env/code defaults (cheap models), batch limit $1
    expect(settings.ai).toEqual({ tasks: {}, batchCostLimitUsd: 1 });
    expect(settings.publishing.autoPublish).toBe(false); // human checkpoint by default
    expect(settings.production).toEqual({ captionPreset: "bold", aspectRatio: "9:16", clipDurationSec: 45 });
    expect(settings.thresholds).toEqual({ minOpportunityScore: 70, minViralityScore: 60 });
  });

  it("merges stored overrides over defaults", () => {
    const { settings } = resolveSettings({
      production: { clipDurationSec: 30 },
      ai: { tasks: { script: { model: "openai:my-model" } }, batchCostLimitUsd: 5 },
    });
    expect(settings.production.clipDurationSec).toBe(30);
    expect(settings.production.aspectRatio).toBe("9:16");
    expect(settings.ai).toEqual({ tasks: { script: { model: "openai:my-model" } }, batchCostLimitUsd: 5 });
  });

  it("falls back to defaults for a section that no longer validates", () => {
    const { settings, invalidSections } = resolveSettings({ production: { clipDurationSec: 9999 } });
    expect(invalidSections).toEqual(["production"]);
    expect(settings.production.clipDurationSec).toBe(45);
  });
});

describe("section schemas", () => {
  it("rejects unsafe model ids", () => {
    expect(aiSettingsSchema.safeParse({ tasks: { scoring: { model: "anthropic:claude-haiku-5-5" } } }).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ tasks: { scoring: { model: "anthropic:x; drop table" } } }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ tasks: { scoring: { model: "mistral:x" } } }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ batchCostLimitUsd: -1 }).success).toBe(false);
  });

  it("coerces numeric form values and enforces ranges", () => {
    expect(productionSettingsSchema.parse({ clipDurationSec: "60" }).clipDurationSec).toBe(60);
    expect(productionSettingsSchema.safeParse({ clipDurationSec: "5" }).success).toBe(false);
    expect(productionSettingsSchema.safeParse({ clipDurationSec: "12.5" }).success).toBe(false);
  });

  it("recognises section keys", () => {
    expect(isSettingsSection("ai")).toBe(true);
    expect(isSettingsSection("toString")).toBe(false);
    expect(isSettingsSection(null)).toBe(false);
  });
});
