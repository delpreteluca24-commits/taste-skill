import { z } from "zod";
import { describe, expect, it } from "vitest";

import { suggestEditorialAlternatives } from "@/lib/rights/alternatives";
import { suggestRightsStatus } from "@/lib/rights/classify";
import {
  assetKindLabel,
  classificationSchema,
  commercialUseLabel,
  commercialUseValue,
  escapeLike,
  factsFromFields,
  footageHeadline,
  greenBasisField,
  greenBasisFieldErrors,
  hasLocationMention,
  hasNumericStatistic,
  hasRightsFilters,
  isAssetType,
  isHttpUrl,
  kindToSourceType,
  orIlikeFilter,
  ownershipLabel,
  parseCommercialUse,
  parseRightsFilters,
  productionFormatOptions,
  productionFormatsSchema,
  publisherFromUrl,
  registerAssetSchema,
  rightsDecisionSchema,
} from "@/lib/rights/schema";

const ASSET = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";
const CHECK = "0d9e8f7a-6b5c-4d3e-9f21-0a1b2c3d4e5f";

/** form payload as the browser sends it: strings everywhere, "" for empty fields */
const form = (over: Record<string, string | undefined> = {}) => ({
  assetType: "video",
  assetId: ASSET,
  status: "yellow",
  ownership: "unknown",
  owner: "",
  sourceDetail: "",
  license: "",
  commercialUse: "unknown",
  authorization: "",
  transformationRequired: undefined,
  risk: "",
  evidenceUrl: "",
  notes: "",
  ...over,
});

const fieldErrors = (input: unknown) => {
  const r = classificationSchema.safeParse(input);
  expect(r.success).toBe(false);
  return z.flattenError(r.error!).fieldErrors as Record<string, string[] | undefined>;
};

describe("classification form schema", () => {
  it("accepts a YELLOW with nothing documented and normalises empty fields to null", () => {
    const r = classificationSchema.parse(form());
    expect(r).toMatchObject({
      status: "yellow",
      ownership: "unknown",
      owner: null,
      sourceDetail: null,
      license: null,
      commercialUse: null,
      authorization: null,
      transformationRequired: false,
      risk: null,
      evidenceUrl: null,
      notes: null,
    });
  });

  it("parses all ten rights-first fields", () => {
    const r = classificationSchema.parse(
      form({
        status: "green",
        ownership: "licensed",
        owner: "  Club FC ",
        sourceDetail: "Club media office",
        license: "Editorial + social, 12 months",
        commercialUse: "yes",
        authorization: "Email from press office, 2026-10-01",
        transformationRequired: "on",
        risk: "Low",
        evidenceUrl: "https://example.test/license.pdf",
        notes: "Commentary only",
      }),
    );
    expect(r).toMatchObject({
      status: "green",
      ownership: "licensed",
      owner: "Club FC",
      sourceDetail: "Club media office",
      license: "Editorial + social, 12 months",
      commercialUse: true,
      authorization: "Email from press office, 2026-10-01",
      transformationRequired: true,
      risk: "Low",
      evidenceUrl: "https://example.test/license.pdf",
      notes: "Commentary only",
    });
  });

  it("maps commercial use tri-state: yes → true, no → false, unknown/missing → null", () => {
    expect(classificationSchema.parse(form({ commercialUse: "no", status: "red" })).commercialUse).toBe(false);
    expect(classificationSchema.parse(form({ commercialUse: undefined })).commercialUse).toBeNull();
    expect(fieldErrors(form({ commercialUse: "maybe" })).commercialUse?.[0]).toMatch(/allowed, not allowed or unknown/);
  });

  it("rejects bad references and statuses with friendly messages", () => {
    const errors = fieldErrors(form({ assetType: "story", assetId: "nope", status: "unchecked", ownership: "stolen" }));
    expect(errors.assetType?.[0]).toBe("Unknown asset type");
    expect(errors.assetId?.[0]).toBe("Invalid asset");
    expect(errors.status?.[0]).toBe("Pick GREEN, YELLOW or RED");
    expect(errors.ownership?.[0]).toBe("Pick who holds the rights");
  });

  it("only accepts http(s) evidence links", () => {
    expect(fieldErrors(form({ evidenceUrl: "javascript:alert(1)" })).evidenceUrl?.[0]).toBe("Paste a full http(s) link");
    expect(fieldErrors(form({ evidenceUrl: "ftp://files.test/l.pdf" })).evidenceUrl?.[0]).toBe("Paste a full http(s) link");
    expect(fieldErrors(form({ evidenceUrl: `https://x.test/${"a".repeat(2050)}` })).evidenceUrl?.[0]).toMatch(/2048/);
  });

  it("enforces length limits", () => {
    expect(fieldErrors(form({ owner: "x".repeat(201) })).owner?.[0]).toBe("Keep it under 200 characters");
    expect(fieldErrors(form({ notes: "x".repeat(4001) })).notes?.[0]).toBe("Keep it under 4000 characters");
  });

  describe("GREEN rule (mirrors rights_checks_green_requires_basis)", () => {
    it("accepts GREEN for owned or public-domain material with commercial use and no evidence link", () => {
      expect(classificationSchema.safeParse(form({ status: "green", ownership: "owned", commercialUse: "yes" })).success).toBe(true);
      expect(classificationSchema.safeParse(form({ status: "green", ownership: "public_domain", commercialUse: "yes" })).success).toBe(true);
    });

    it("puts each missing basis on its own field, plus a status message", () => {
      const errors = fieldErrors(form({ status: "green", ownership: "unknown", commercialUse: "unknown" }));
      expect(errors.commercialUse?.[0]).toBe("For GREEN, commercial use must be confirmed.");
      expect(errors.ownership?.[0]).toMatch(/^For GREEN, ownership must be owned, licensed, authorized/);
      expect(errors.evidenceUrl?.[0]).toMatch(/^For GREEN, an evidence link/);
      expect(errors.status?.[0]).toMatch(/GREEN needs a documented basis .* Record YELLOW until it is on file\./);
    });

    it("requires an evidence link for licensed / authorized / creator-provided material", () => {
      for (const ownership of ["licensed", "authorized", "creator_provided"]) {
        const errors = fieldErrors(form({ status: "green", ownership, commercialUse: "yes" }));
        expect(Object.keys(errors).sort()).toEqual(["evidenceUrl", "status"]);
      }
      expect(
        classificationSchema.safeParse(form({ status: "green", ownership: "authorized", commercialUse: "yes", evidenceUrl: "https://x.test/ok" })).success,
      ).toBe(true);
    });

    it("never accepts GREEN for third-party material, even with evidence", () => {
      const errors = fieldErrors(form({ status: "green", ownership: "third_party", commercialUse: "yes", evidenceUrl: "https://x.test/e" }));
      expect(errors.ownership?.[0]).toMatch(/For GREEN, ownership/);
      expect(errors.commercialUse).toBeUndefined();
    });

    it("doesn't apply to YELLOW or RED", () => {
      expect(classificationSchema.safeParse(form({ status: "red", ownership: "third_party", commercialUse: "no" })).success).toBe(true);
      expect(classificationSchema.safeParse(form({ status: "yellow", ownership: "licensed" })).success).toBe(true);
    });

    it("greenBasisFieldErrors / greenBasisField map messages to form fields", () => {
      expect(greenBasisFieldErrors({ ownership: "owned", commercialUse: true, evidenceUrl: null })).toEqual({});
      expect(greenBasisFieldErrors({ ownership: "licensed", commercialUse: false, evidenceUrl: " " })).toEqual({
        commercialUse: "For GREEN, commercial use must be confirmed.",
        evidenceUrl: "For GREEN, an evidence link (license, contract or written permission) is required.",
      });
      expect(greenBasisField("something new")).toBe("status");
    });
  });
});

describe("classification helpers", () => {
  it("labels ownership and commercial use for display", () => {
    expect(ownershipLabel("creator_provided")).toBe("Provided by creator / athlete");
    expect(ownershipLabel(null)).toBe("—");
    expect(ownershipLabel("legacy_value")).toBe("legacy_value");
    expect([true, false, null].map(commercialUseLabel)).toEqual(["Allowed", "Not allowed", "Unknown"]);
    expect([true, false, null, undefined].map(commercialUseValue)).toEqual(["yes", "no", "unknown", "unknown"]);
    expect(["yes", "no", "unknown", null].map(parseCommercialUse)).toEqual([true, false, null, null]);
  });

  it("isAssetType / isHttpUrl", () => {
    expect(["source", "video", "story", 1].map(isAssetType)).toEqual([true, true, false, false]);
    expect(isHttpUrl("https://x.test")).toBe(true);
    expect(isHttpUrl("mailto:a@b.test")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("factsFromFields feeds the live suggestion (incl. the source's restricted license)", () => {
    const fields = {
      ownership: "licensed" as const,
      commercialUse: true,
      evidenceUrl: "https://x.test/l.pdf",
      authorization: null,
      license: "CC BY 4.0",
      transformationRequired: true,
      risk: null,
    };
    const green = suggestRightsStatus(factsFromFields(fields));
    expect(green.status).toBe("green");
    expect(green.conditions.join(" ")).toMatch(/transformed/);
    expect(suggestRightsStatus(factsFromFields(fields, "restricted")).status).toBe("red");
    expect(suggestRightsStatus(factsFromFields({ ...fields, risk: "Copyright claim on file" })).status).toBe("red");
  });
});

describe("register asset form", () => {
  it("requires a full http(s) link and a known kind", () => {
    const missing = registerAssetSchema.safeParse({ url: "  ", kind: "video" });
    expect(z.flattenError(missing.error!).fieldErrors.url?.[0]).toBe("Paste the asset's link");
    const bad = registerAssetSchema.safeParse({ url: "javascript:alert(1)", kind: "gif" });
    const errors = z.flattenError(bad.error!).fieldErrors;
    expect(errors.url?.[0]).toBe("Paste a full http(s) link");
    expect(errors.kind?.[0]).toBe("Pick what kind of asset this is");
  });

  it("trims and nulls optional fields", () => {
    expect(registerAssetSchema.parse({ url: " https://x.test/v ", title: "", publisher: " Club TV ", kind: "social" })).toEqual({
      url: "https://x.test/v",
      title: null,
      publisher: "Club TV",
      kind: "social",
    });
  });

  it("maps kinds to sources.source_type (images have no type of their own)", () => {
    expect(kindToSourceType("video")).toBe("video");
    expect(kindToSourceType("social")).toBe("social");
    expect(kindToSourceType("official")).toBe("official");
    expect(kindToSourceType("image")).toBe("other");
    expect(kindToSourceType("other")).toBe("other");
  });

  it("derives the publisher from the link when none is given", () => {
    expect(publisherFromUrl("https://www.club.test/media/1")).toBe("club.test");
    expect(publisherFromUrl("https://club.test/1", "  Club FC ")).toBe("Club FC");
    expect(publisherFromUrl("garbage")).toBe("Unknown publisher");
  });

  it("labels asset kinds for the table", () => {
    expect(assetKindLabel("video", "mp4")).toBe("Uploaded video (mp4)");
    expect(assetKindLabel("video", "video")).toBe("Uploaded video");
    expect(assetKindLabel("source", "social")).toBe("Social post");
    expect(assetKindLabel("source", "news")).toBe("Article");
    expect(assetKindLabel("source", null)).toBe("Link");
  });
});

describe("YELLOW usage decision", () => {
  it("an approval must explain who confirmed what", () => {
    const r = rightsDecisionSchema.safeParse({ checkId: CHECK, decision: "approved", notes: "ok" });
    expect(z.flattenError(r.error!).fieldErrors.notes?.[0]).toMatch(/who confirmed the rights/);
    expect(rightsDecisionSchema.safeParse({ checkId: CHECK, decision: "approved", notes: "Press office confirmed by email, kept in Drive" }).success).toBe(true);
  });

  it("a rejection needs no notes; unknown decisions and ids are refused", () => {
    expect(rightsDecisionSchema.parse({ checkId: CHECK, decision: "rejected", notes: "" })).toEqual({ checkId: CHECK, decision: "rejected", notes: null });
    const r = rightsDecisionSchema.safeParse({ checkId: "x", decision: "maybe" });
    const errors = z.flattenError(r.error!).fieldErrors;
    expect(errors.checkId?.[0]).toBe("Invalid classification");
    expect(errors.decision?.[0]).toBe("Approve or reject");
  });
});

describe("production formats (STORY ≠ FOOTAGE)", () => {
  it("dedupes and orders formats like the catalogue", () => {
    const r = productionFormatsSchema.parse({ storyId: ASSET, formats: ["map", "original_commentary", "map", "statistics"] });
    expect(r.formats).toEqual(["original_commentary", "statistics", "map"]);
    expect(productionFormatsSchema.parse({ storyId: ASSET, formats: [] }).formats).toEqual([]);
  });

  it("refuses unknown formats and invalid stories", () => {
    expect(productionFormatsSchema.safeParse({ storyId: ASSET, formats: ["broadcast_highlights"] }).success).toBe(false);
    expect(productionFormatsSchema.safeParse({ storyId: "nope", formats: [] }).success).toBe(false);
  });

  it("keeps saved formats the engine no longer suggests, after the ranked suggestions", () => {
    const result = suggestEditorialAlternatives({ assets: [], confirmedFacts: 0, timelineItems: 0, quotes: 0, hasStatistics: false, hasLocations: false });
    const options = productionFormatOptions(result.suggestions, ["map", "voiceover"]);
    expect(options.slice(0, result.suggestions.length).map((o) => o.format)).toEqual(result.suggestions.map((s) => s.format));
    expect(options.at(-1)).toEqual({ format: "map", label: "Maps", score: null, reason: null, risk: "none" });
    expect(options.filter((o) => o.format === "voiceover")).toHaveLength(1);
    expect(options.find((o) => o.format === "screenshots")).toMatchObject({ risk: "check", caution: expect.stringMatching(/Only when appropriate/) });
    expect(options.find((o) => o.format === "authorized_footage")?.risk).toBe("documented");
  });

  it("never claims an approval the story doesn't have", () => {
    const engine = "No usable footage — the story stays approved. Produce it with original formats.";
    expect(footageHeadline("unavailable", engine, "approved")).toBe(engine);
    expect(footageHeadline("unavailable", engine, "draft")).not.toMatch(/approved/);
    expect(footageHeadline("none", "No footage linked.", "draft")).toBe("No footage linked.");
  });
});

describe("research material heuristics", () => {
  it("numeric statistics: scores, percentages and counts count; dates and years alone don't", () => {
    expect(hasNumericStatistic(["Bologna won 3-0 at San Siro"])).toBe(true);
    expect(hasNumericStatistic(["Possession was 62%"])).toBe(true);
    expect(hasNumericStatistic(["He has scored 14 goals this season"])).toBe(true);
    expect(hasNumericStatistic(["The match was played in 2024"])).toBe(false);
    expect(hasNumericStatistic(["Signed on 12 May 2025", "Contract renewed on 2025-06-30", "Season 2024/25 preview"])).toBe(false);
    expect(hasNumericStatistic(["Kick-off on March 3rd"])).toBe(false);
    expect(hasNumericStatistic([])).toBe(false);
  });

  it("locations: venue words or 'at/in <Place>', ignoring months and weekdays", () => {
    expect(hasLocationMention(["Bologna won at Anfield"])).toBe(true);
    expect(hasLocationMention(["The final is in Madrid"])).toBe(true);
    expect(hasLocationMention(["A sold-out stadium"])).toBe(true);
    expect(hasLocationMention(["The match is in May", "Played on Sunday", null, undefined, ""])).toBe(false);
    expect(hasLocationMention(["he scored in the second half"])).toBe(false);
  });
});

describe("list filters", () => {
  it("parses valid params and drops anything else", () => {
    expect(parseRightsFilters({ status: "yellow", type: "social", awaiting: "1", q: "  derby  " })).toEqual({
      status: "yellow",
      type: "social",
      awaitingApproval: true,
      search: "derby",
    });
    expect(parseRightsFilters({ status: "purple", type: ["upload", "video"], awaiting: "yes", q: "" })).toEqual({ type: "upload" });
    expect(parseRightsFilters({ q: "x".repeat(300) }).search).toHaveLength(100);
    expect(hasRightsFilters({})).toBe(false);
    expect(hasRightsFilters(parseRightsFilters({ status: "red" }))).toBe(true);
  });

  it("search filter escapes LIKE wildcards and PostgREST syntax", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(orIlikeFilter(["title", "url"], 'a,b.(c)"')).toBe('title.ilike."%a,b.(c)\\"%",url.ilike."%a,b.(c)\\"%"');
  });
});
