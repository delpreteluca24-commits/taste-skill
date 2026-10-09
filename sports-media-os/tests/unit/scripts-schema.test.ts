import { describe, expect, it } from "vitest";

import {
  DEFAULT_ANGLES,
  generateScriptsSchema,
  HOOK_TYPES,
  manualHookSchema,
  manualVersionSchema,
  scriptDecisionSchema,
  SCRIPT_SECTIONS,
  transformScriptSchema,
} from "@/lib/scripts/schema";

const id = "6f1d0c38-2b8a-4c43-9a55-1d1b3a6f7e01";

describe("generate input", () => {
  it("defaults to three angles and accepts 1–5 known angles (deduplicated)", () => {
    expect(DEFAULT_ANGLES).toEqual(["breaking_news", "storytelling", "analysis"]);
    expect(generateScriptsSchema.parse({ storyId: id, angles: ["analysis", "analysis", "controversy"] }).angles).toEqual(["analysis", "controversy"]);
    expect(generateScriptsSchema.safeParse({ storyId: id, angles: [] }).success).toBe(false);
    expect(generateScriptsSchema.safeParse({ storyId: id, angles: ["clickbait"] }).success).toBe(false);
    expect(generateScriptsSchema.safeParse({ storyId: "nope", angles: ["analysis"] }).success).toBe(false);
  });
});

describe("transform input", () => {
  it("needs a tone only for change_tone", () => {
    expect(transformScriptSchema.safeParse({ scriptId: id, operation: "shorten" }).success).toBe(true);
    const missing = transformScriptSchema.safeParse({ scriptId: id, operation: "change_tone", tone: " " });
    expect(missing.success).toBe(false);
    expect(transformScriptSchema.parse({ scriptId: id, operation: "change_tone", tone: " calm " }).tone).toBe("calm");
    expect(transformScriptSchema.safeParse({ scriptId: id, operation: "manual" }).success).toBe(false);
  });
});

describe("manual version input", () => {
  const sections = Object.fromEntries(SCRIPT_SECTIONS.map((s) => [s.key, `${s.label} text`]));

  it("requires all six sections and keeps the optional angle/tone", () => {
    const parsed = manualVersionSchema.parse({ storyId: id, ...sections, angle: "analysis", tone: "" });
    expect(parsed).toMatchObject({ angle: "analysis", tone: null, hook: "Hook text" });
    expect(manualVersionSchema.parse({ storyId: id, ...sections }).angle).toBeNull();
    const missingHook = manualVersionSchema.safeParse({ storyId: id, ...sections, hook: "   " });
    expect(missingHook.success).toBe(false);
  });

  it("caps hook and CTA lengths", () => {
    expect(manualVersionSchema.safeParse({ storyId: id, ...sections, hook: "x".repeat(301) }).success).toBe(false);
  });
});

describe("decisions and hooks", () => {
  it("accepts approve / reject only, notes optional", () => {
    expect(scriptDecisionSchema.parse({ scriptId: id, decision: "approved", notes: "" }).notes).toBeNull();
    expect(scriptDecisionSchema.safeParse({ scriptId: id, decision: "auto" }).success).toBe(false);
  });

  it("validates manual hooks", () => {
    expect(HOOK_TYPES).toEqual(["curiosity", "controversial", "shock", "mystery", "story", "statistical"]);
    expect(manualHookSchema.parse({ storyId: id, hookType: "story", text: "  One   night   at San Siro " }).text).toBe("One night at San Siro");
    expect(manualHookSchema.safeParse({ storyId: id, hookType: "rage", text: "x" }).success).toBe(false);
  });
});
