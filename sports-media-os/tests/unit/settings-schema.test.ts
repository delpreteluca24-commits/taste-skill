import { describe, expect, it } from "vitest";

import { aiSettingsSchema, isSettingsSection, productionSettingsSchema, resolveSettings } from "@/lib/settings/schema";

describe("resolveSettings", () => {
  it("returns safe defaults when nothing is stored", () => {
    const { settings, invalidSections } = resolveSettings({});
    expect(invalidSections).toEqual([]);
    expect(settings.ai).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(settings.publishing.autoPublish).toBe(false); // human checkpoint by default
    expect(settings.production).toEqual({ captionPreset: "bold", aspectRatio: "9:16", clipDurationSec: 45 });
    expect(settings.thresholds).toEqual({ minOpportunityScore: 70, minViralityScore: 60 });
  });

  it("merges stored overrides over defaults", () => {
    const { settings } = resolveSettings({ production: { clipDurationSec: 30 }, ai: { provider: "openai", model: "my-model" } });
    expect(settings.production.clipDurationSec).toBe(30);
    expect(settings.production.aspectRatio).toBe("9:16");
    expect(settings.ai).toEqual({ provider: "openai", model: "my-model" });
  });

  it("falls back to defaults for a section that no longer validates", () => {
    const { settings, invalidSections } = resolveSettings({ production: { clipDurationSec: 9999 } });
    expect(invalidSections).toEqual(["production"]);
    expect(settings.production.clipDurationSec).toBe(45);
  });
});

describe("section schemas", () => {
  it("rejects unsafe model ids", () => {
    expect(aiSettingsSchema.safeParse({ provider: "anthropic", model: "claude-opus-5-5" }).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ provider: "anthropic", model: "x; drop table" }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ provider: "anthropic", model: " " }).success).toBe(false);
    expect(aiSettingsSchema.safeParse({ provider: "mistral", model: "x" }).success).toBe(false);
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
