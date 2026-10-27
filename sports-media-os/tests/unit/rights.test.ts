import { describe, expect, it } from "vitest";

import { footageStatus, suggestEditorialAlternatives } from "@/lib/rights/alternatives";
import { canUseInProduction, greenBasisMissing, suggestRightsStatus } from "@/lib/rights/classify";

describe("rights classification", () => {
  it("GREEN for owned material with commercial use", () => {
    const s = suggestRightsStatus({ ownership: "owned", commercialUse: true });
    expect(s.status).toBe("green");
    expect(s.greenAllowed).toBe(true);
  });

  it("GREEN for licensed material only with evidence on file", () => {
    expect(suggestRightsStatus({ ownership: "licensed", commercialUse: true, evidenceUrl: "https://x.test/license.pdf" }).status).toBe("green");
    const noEvidence = suggestRightsStatus({ ownership: "licensed", commercialUse: true });
    expect(noEvidence.status).toBe("yellow");
    expect(noEvidence.reasons.join(" ")).toMatch(/no evidence/i);
  });

  it("RED for third-party footage without permission (typical broadcast highlights)", () => {
    const s = suggestRightsStatus({ ownership: "third_party", commercialUse: null });
    expect(s.status).toBe("red");
    expect(s.conditions.join(" ")).toMatch(/original formats/);
  });

  it("RED when commercial use is denied, the license is restricted or a takedown is known", () => {
    expect(suggestRightsStatus({ ownership: "authorized", commercialUse: false, evidenceUrl: "https://x.test" }).status).toBe("red");
    expect(suggestRightsStatus({ ownership: "owned", commercialUse: true, licenseStatus: "restricted" }).status).toBe("red");
    expect(suggestRightsStatus({ ownership: "owned", commercialUse: true, knownRisk: "DMCA takedown received" }).status).toBe("red");
  });

  it("YELLOW when ownership or commercial use is unknown", () => {
    expect(suggestRightsStatus({ ownership: "unknown", commercialUse: true }).status).toBe("yellow");
    expect(suggestRightsStatus({ ownership: "creator_provided", commercialUse: null, evidenceUrl: "https://x.test" }).status).toBe("yellow");
  });

  it("records transformation as a usage condition", () => {
    const s = suggestRightsStatus({ ownership: "licensed", commercialUse: true, evidenceUrl: "https://x.test", transformationRequired: true });
    expect(s.status).toBe("green");
    expect(s.conditions[0]).toMatch(/transformed/);
  });

  it("mirrors the DB rule for a documented GREEN", () => {
    expect(greenBasisMissing({ ownership: "owned", commercialUse: true })).toEqual([]);
    expect(greenBasisMissing({ ownership: "third_party", commercialUse: true, evidenceUrl: "https://x.test" })).toHaveLength(1);
    expect(greenBasisMissing({ ownership: "unknown", commercialUse: null })).toHaveLength(3);
  });

  it("production gate: GREEN yes; YELLOW only human-approved, never automated; RED never", () => {
    expect(canUseInProduction("green", { yellowApproved: false, automated: true })).toBe(true);
    expect(canUseInProduction("yellow", { yellowApproved: true, automated: false })).toBe(true);
    expect(canUseInProduction("yellow", { yellowApproved: true, automated: true })).toBe(false);
    expect(canUseInProduction("yellow", { yellowApproved: false, automated: false })).toBe(false);
    expect(canUseInProduction("red", { yellowApproved: true, automated: false })).toBe(false);
    expect(canUseInProduction("unchecked", { yellowApproved: false, automated: false })).toBe(false);
  });
});

describe("STORY ≠ FOOTAGE — editorial alternatives", () => {
  const material = { confirmedFacts: 4, timelineItems: 5, quotes: 2, hasStatistics: true, hasLocations: false };

  it("keeps a story producible when no footage is usable", () => {
    const r = suggestEditorialAlternatives({ ...material, assets: [{ status: "red", usable: false }] });
    expect(r.footageStatus).toBe("unavailable");
    expect(r.headline).toMatch(/stays approved/);
    const top = r.suggestions.slice(0, 5).map((s) => s.format);
    expect(top).toEqual(expect.arrayContaining(["original_commentary", "voiceover", "statistics"]));
    for (const s of r.suggestions.slice(0, 5)) expect(s.caution).toBeUndefined();
  });

  it("suggests every alternative family from the spec", () => {
    const r = suggestEditorialAlternatives({ ...material, hasLocations: true, assets: [] });
    expect(r.suggestions.map((s) => s.format)).toEqual(
      expect.arrayContaining([
        "original_commentary",
        "voiceover",
        "statistics",
        "graphics",
        "timeline",
        "animation",
        "map",
        "original_visuals",
        "authorized_footage",
        "screenshots",
        "public_sources",
        "creator_provided",
      ]),
    );
  });

  it("marks screenshots and third-party material with a caution", () => {
    const r = suggestEditorialAlternatives({ ...material, assets: [] });
    expect(r.suggestions.find((s) => s.format === "screenshots")!.caution).toMatch(/Only when appropriate/);
    expect(r.suggestions.find((s) => s.format === "creator_provided")!.caution).toMatch(/authorization/);
  });

  it("uses research depth to rank data formats", () => {
    const rich = suggestEditorialAlternatives({ ...material, assets: [] });
    const thin = suggestEditorialAlternatives({ confirmedFacts: 0, timelineItems: 0, quotes: 0, hasStatistics: false, hasLocations: false, assets: [] });
    const score = (r: typeof rich, f: string) => r.suggestions.find((s) => s.format === f)!.score;
    expect(score(rich, "timeline")).toBeGreaterThan(score(thin, "timeline"));
    expect(score(rich, "statistics")).toBeGreaterThan(score(thin, "statistics"));
  });

  it("classifies footage status", () => {
    expect(footageStatus([])).toBe("none");
    expect(footageStatus([{ status: "green", usable: true }])).toBe("usable");
    expect(footageStatus([{ status: "green", usable: true }, { status: "red", usable: false }])).toBe("partial");
    expect(footageStatus([{ status: "yellow", usable: false }])).toBe("unavailable");
  });
});
