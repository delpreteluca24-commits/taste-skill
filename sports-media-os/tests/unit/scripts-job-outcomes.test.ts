import { describe, expect, it } from "vitest";

import { describeGenerateResult, describeHooksResult, describeTransformResult } from "@/components/scripts/use-queued-job";

/** One-line outcomes shown when a Script/Hook Studio job finishes (results read defensively). */

describe("job outcomes", () => {
  it("script.generate: versions written, warnings and failed angles", () => {
    expect(
      describeGenerateResult({
        created: [{ angle: "analysis", warnings: 2 }, { angle: "storytelling", warnings: 0 }],
        failed: [{ angle: "breaking_news", error: "All models failed for the \"script\" task" }],
      }),
    ).toBe('2 versions written, 1 with warnings to check. Not written: breaking news (All models failed for the "script" task).');
    expect(describeGenerateResult({ created: [{ angle: "analysis" }], failed: [] })).toBe("1 version written.");
  });

  it("hooks.generate: count, types and skipped ones", () => {
    expect(describeHooksResult({ inserted: 5, distinctTypes: 5, dropped: { duplicates: 1, discarded: 0 } })).toBe(
      "5 hooks across 5 types (1 repeated or unusable skipped).",
    );
  });

  it("script.transform: says whether the new version became current", () => {
    expect(describeTransformResult({ version: 7, warnings: 2, isCurrent: false })).toBe("Version 7 written (2 warnings to check). Make it current to use it.");
    expect(describeTransformResult({ version: 1, warnings: 0, isCurrent: true })).toBe("Version 1 written and made current.");
  });

  it("never throws on unexpected results", () => {
    for (const bad of [null, undefined, "x", 42, [], { created: "nope" }]) {
      expect(() => describeGenerateResult(bad)).not.toThrow();
      expect(() => describeHooksResult(bad)).not.toThrow();
      expect(describeTransformResult(bad)).toBeNull();
    }
  });
});
