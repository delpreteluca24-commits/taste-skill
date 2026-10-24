import { describe, expect, it } from "vitest";

import {
  answerQuestionSchema,
  claimFormSchema,
  claimStatusSchema,
  linkSourceSchema,
  parseDateInput,
  parseTab,
  publisherFor,
  readItemMeta,
  researchItemSchema,
  sourceFormSchema,
  toItemColumns,
} from "@/lib/research/schema";

const SOURCE = "22222222-2222-4222-8222-222222222222";
const FACT = "33333333-3333-4333-8333-333333333333";

const fieldErrors = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("research item schemas", () => {
  it("quote needs a speaker and an attribution (source or link)", () => {
    const missing = researchItemSchema.safeParse({ type: "quote", speaker: "Coach", content: "We believe." });
    expect(missing.success).toBe(false);
    expect(fieldErrors(missing).sourceId).toMatch(/attribute/i);

    const noSpeaker = researchItemSchema.safeParse({ type: "quote", content: "We believe.", sourceId: SOURCE });
    expect(fieldErrors(noSpeaker).speaker).toMatch(/who said/i);

    const ok = researchItemSchema.parse({ type: "quote", speaker: " Coach ", content: "We believe.", sourceId: SOURCE, url: "" });
    expect(toItemColumns(ok)).toMatchObject({
      item_type: "quote",
      content: "We believe.",
      source_id: SOURCE,
      url: null,
      metadata: { speaker: "Coach" },
    });

    const byLink = researchItemSchema.parse({ type: "quote", speaker: "Coach", content: "x", url: "https://club.test/interview" });
    expect(toItemColumns(byLink)).toMatchObject({ url: "https://club.test/interview", source_id: null });
  });

  it("timeline needs a valid date and keeps the calendar day", () => {
    expect(fieldErrors(researchItemSchema.safeParse({ type: "timeline", title: "Kick-off" })).occurredAt).toBeTruthy();
    expect(fieldErrors(researchItemSchema.safeParse({ type: "timeline", title: "x", occurredAt: "2026-02-30" })).occurredAt).toMatch(/valid date/);
    const t = researchItemSchema.parse({ type: "timeline", title: "Bologna win 3-0", occurredAt: "2026-10-04", sourceId: SOURCE });
    expect(toItemColumns(t)).toMatchObject({ item_type: "timeline", title: "Bologna win 3-0", occurred_at: "2026-10-04T00:00:00.000Z", source_id: SOURCE });
  });

  it("question can only be marked answered with an answer", () => {
    expect(researchItemSchema.safeParse({ type: "question", content: "Who refereed?", answered: true }).success).toBe(false);
    const q = researchItemSchema.parse({ type: "question", content: "Who refereed?", answered: true, answer: "Orsato" });
    expect(toItemColumns(q).metadata).toEqual({ answered: true, answer: "Orsato" });
    const open = researchItemSchema.parse({ type: "question", content: "Who refereed?" });
    expect(toItemColumns(open).metadata).toEqual({ answered: false, answer: null });
  });

  it("competitor needs channel, platform and link; views must be a whole number", () => {
    const base = { type: "competitor", title: "Why Inter collapsed", url: "https://youtube.test/v/1", channel: "TifoTalk", platform: "youtube" };
    expect(researchItemSchema.safeParse({ ...base, views: "12.5" }).success).toBe(false);
    expect(researchItemSchema.safeParse({ ...base, views: "-1" }).success).toBe(false);
    expect(researchItemSchema.safeParse({ ...base, platform: "myspace" }).success).toBe(false);
    expect(researchItemSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
    const c = researchItemSchema.parse({ ...base, views: "120000", publishedAt: "2026-10-05" });
    expect(toItemColumns(c)).toMatchObject({
      item_type: "competitor",
      occurred_at: "2026-10-05T00:00:00.000Z",
      metadata: { channel: "TifoTalk", platform: "youtube", views: 120000 },
    });
    // empty views stay unknown, never 0
    expect(toItemColumns(researchItemSchema.parse({ ...base, views: "" })).metadata.views).toBeNull();
  });

  it("media needs a real link and a kind", () => {
    expect(researchItemSchema.safeParse({ type: "media", title: "Goal clip", url: "ftp://x.test/a" }).success).toBe(false);
    const m = researchItemSchema.parse({ type: "media", title: "Club photo", url: "https://club.test/p.jpg", mediaKind: "image" });
    expect(toItemColumns(m)).toMatchObject({ item_type: "media", metadata: { media_kind: "image" } });
  });

  it("note and context need text; source ids must be uuids", () => {
    expect(researchItemSchema.safeParse({ type: "note", content: "   " }).success).toBe(false);
    expect(researchItemSchema.safeParse({ type: "context", content: "x", sourceId: "not-a-uuid" }).success).toBe(false);
    expect(researchItemSchema.safeParse({ type: "unknown", content: "x" }).success).toBe(false);
  });
});

describe("dates", () => {
  it("parses date and datetime-local inputs as UTC, rejects nonsense", () => {
    expect(parseDateInput("2026-10-04")).toBe("2026-10-04T00:00:00.000Z");
    expect(parseDateInput("2026-10-04T20:45")).toBe("2026-10-04T20:45:00.000Z");
    expect(parseDateInput("2026-10-04T20:45:00+02:00")).toBe("2026-10-04T18:45:00.000Z");
    expect(parseDateInput("04/10/2026")).toBeNull();
    expect(parseDateInput("2026-13-01")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});

describe("metadata read-back", () => {
  it("never trusts stored metadata blindly", () => {
    const m = readItemMeta({ speaker: 42, answered: "yes", views: -5, platform: "youtube", ai: true, model: "claude-sonnet-5-5", source_ids: [SOURCE] });
    expect(m).toMatchObject({ speaker: null, answered: false, views: null, platform: "youtube", ai: true, model: "claude-sonnet-5-5", sourceIds: [SOURCE] });
    expect(readItemMeta(null)).toMatchObject({ answered: false, ai: false, sourceIds: [] });
    expect(readItemMeta(["array"])).toMatchObject({ answered: false });
  });
});

describe("sources form", () => {
  it("requires an http(s) link and defaults the type", () => {
    expect(sourceFormSchema.safeParse({ url: "not a url" }).success).toBe(false);
    expect(sourceFormSchema.parse({ url: "https://www.gazzetta.test/a" })).toMatchObject({ type: "news", publisher: null, title: null });
    expect(sourceFormSchema.safeParse({ url: "https://x.test", type: "tv" }).success).toBe(false);
  });

  it("falls back to the link's host as publisher", () => {
    expect(publisherFor("https://www.gazzetta.test/a", null)).toBe("gazzetta.test");
    expect(publisherFor("https://x.test/a", "  Gazzetta ")).toBe("Gazzetta");
  });
});

describe("claim schemas", () => {
  it("claims are critical by default", () => {
    expect(claimFormSchema.parse({ claim: "Bologna won 3-0" })).toEqual({ claim: "Bologna won 3-0", isCritical: true });
    expect(claimFormSchema.safeParse({ claim: "" }).success).toBe(false);
  });

  it("links default to 'supports' and accept only the three relations", () => {
    expect(linkSourceSchema.parse({ factId: FACT, sourceId: SOURCE })).toMatchObject({ relation: "supports", excerpt: null, locator: null });
    expect(linkSourceSchema.safeParse({ factId: FACT, sourceId: SOURCE, relation: "proves" }).success).toBe(false);
    expect(linkSourceSchema.safeParse({ factId: FACT, sourceId: "" }).success).toBe(false);
  });

  it("status confidence is 0..1, empty means not assessed", () => {
    expect(claimStatusSchema.parse({ factId: FACT, status: "confirmed", confidence: "0.9" })).toMatchObject({ confidence: 0.9 });
    expect(claimStatusSchema.parse({ factId: FACT, status: "uncertain", confidence: "" })).toMatchObject({ confidence: null });
    expect(claimStatusSchema.safeParse({ factId: FACT, status: "confirmed", confidence: "85" }).success).toBe(false);
    expect(claimStatusSchema.safeParse({ factId: FACT, status: "verified" }).success).toBe(false);
  });

  it("answering a question needs the answer", () => {
    expect(answerQuestionSchema.safeParse({ itemId: FACT, answered: true, answer: "" }).success).toBe(false);
    expect(answerQuestionSchema.parse({ itemId: FACT, answered: false })).toMatchObject({ answered: false, answer: null });
  });
});

describe("tabs", () => {
  it("unknown tabs fall back to overview", () => {
    expect(parseTab("claims")).toBe("claims");
    expect(parseTab(["media", "x"])).toBe("media");
    expect(parseTab("drop table")).toBe("overview");
    expect(parseTab(undefined)).toBe("overview");
  });
});
