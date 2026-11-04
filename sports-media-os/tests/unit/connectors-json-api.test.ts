import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { eventsMappingSchema, getPath, mapEventStatus, parseConnectorConfig, parseJsonEvents, parseJsonSources, sourcesMappingSchema } from "@/lib/connectors/parse-json-api";
import { ConnectorParseError } from "@/lib/connectors/types";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/json/${name}`, import.meta.url), "utf8");

describe("getPath", () => {
  const doc = { data: { items: [{ title: "a", tags: ["x", "y"] }] }, n: 0 };

  it("walks dot paths and array indices", () => {
    expect(getPath(doc, "data.items.0.title")).toBe("a");
    expect(getPath(doc, "data.items.0.tags.1")).toBe("y");
    expect(getPath(doc, "n")).toBe(0);
    expect(getPath(doc, undefined)).toBe(doc);
  });

  it("returns undefined for missing paths and never reads inherited properties", () => {
    expect(getPath(doc, "data.missing.title")).toBeUndefined();
    expect(getPath(doc, "data.items.x")).toBeUndefined();
    expect(getPath(doc, "n.toFixed")).toBeUndefined();
    expect(getPath(doc, "constructor")).toBeUndefined();
    expect(getPath({}, "__proto__")).toBeUndefined();
  });
});

describe("mapping config schema", () => {
  it("requires title and url paths for sources", () => {
    expect(sourcesMappingSchema.safeParse({ titlePath: "headline", urlPath: "links.web" }).success).toBe(true);
    expect(sourcesMappingSchema.safeParse({ titlePath: "headline" }).success).toBe(false);
    expect(sourcesMappingSchema.safeParse({ urlPath: "links.web" }).success).toBe(false);
  });

  it("rejects invalid or dangerous paths and accepts empty optional ones", () => {
    expect(sourcesMappingSchema.safeParse({ titlePath: "a b", urlPath: "u" }).success).toBe(false);
    expect(sourcesMappingSchema.safeParse({ titlePath: "t", urlPath: "data..u" }).success).toBe(false);
    expect(sourcesMappingSchema.safeParse({ titlePath: "t", urlPath: "__proto__.x" }).success).toBe(false);
    expect(sourcesMappingSchema.parse({ titlePath: "t", urlPath: "u", itemsPath: "" })).toEqual({ titlePath: "t", urlPath: "u" });
  });

  it("accepts comma-separated title paths for events", () => {
    expect(eventsMappingSchema.safeParse({ titlePath: "teams.home.name, teams.away.name" }).success).toBe(true);
    expect(eventsMappingSchema.safeParse({ titlePath: "teams.home.name,bad path" }).success).toBe(false);
  });

  it("parseConnectorConfig validates per target", () => {
    expect(parseConnectorConfig("sources", { titlePath: "t", urlPath: "u" })).toMatchObject({ ok: true, target: "sources" });
    expect(parseConnectorConfig("events", { titlePath: "t" })).toMatchObject({ ok: true, target: "events" });
    expect(parseConnectorConfig("sources", {})).toMatchObject({ ok: false });
    expect(parseConnectorConfig("other", {})).toMatchObject({ ok: false });
  });
});

describe("parseJsonSources", () => {
  const mapping = sourcesMappingSchema.parse({
    itemsPath: "data.articles",
    titlePath: "headline",
    urlPath: "links.web",
    publishedAtPath: "published",
    summaryPath: "standfirst",
    authorPath: "byline",
  });
  const result = parseJsonSources(fixture("news-api.json"), mapping, { baseUrl: "https://hoops.example.com/api/v1/news" });

  it("maps fields and skips items without a usable link", () => {
    expect(result.format).toBe("json");
    expect(result.items).toHaveLength(3);
    expect(result.skipped).toBe(3);
    expect(result.items[0]).toEqual({
      title: "Basketball: Example City Comets extend winning run to nine",
      url: "https://hoops.example.com/news/comets-nine-straight?utm_campaign=api&ref=home",
      publishedAt: "2026-10-07T23:10:00.000Z",
      summary: "The Comets beat the Harbour Hawks 112–104 behind a 38-point night.",
      author: "Casey Analyst",
      categories: [],
      guid: null,
    });
  });

  it("resolves relative links, epoch dates and drops bare e-mail bylines", () => {
    expect(result.items[1]).toMatchObject({
      url: "https://hoops.example.com/news/hawks-guard-ankle",
      publishedAt: "2026-10-08T22:53:20.000Z",
      author: null,
    });
  });

  it("keeps a summary-only item with a null title", () => {
    expect(result.items[2]).toMatchObject({ title: null, summary: "Summary-only item is kept with a null title." });
  });

  it("explains a wrong items path or a non-JSON body", () => {
    expect(() => parseJsonSources(fixture("news-api.json"), { ...mapping, itemsPath: "data.nope" })).toThrow(/No list found at "data.nope"/);
    expect(() => parseJsonSources(fixture("news-api.json"), { ...mapping, itemsPath: undefined })).toThrow(/set the items path/);
    expect(() => parseJsonSources("<rss/>", mapping)).toThrow(ConnectorParseError);
    expect(() => parseJsonSources("", mapping)).toThrow(/Empty/);
  });

  it("accepts a top-level array without an items path", () => {
    const body = JSON.stringify([{ headline: "A", links: { web: "https://x.example.com/a" } }]);
    expect(parseJsonSources(body, { ...mapping, itemsPath: undefined }).items).toHaveLength(1);
  });
});

describe("parseJsonEvents", () => {
  const mapping = eventsMappingSchema.parse({
    itemsPath: "response.fixtures",
    titlePath: "teams.home.name,teams.away.name",
    startsAtPath: "kickoff",
    endsAtPath: "end",
    competitionPath: "league.name",
    venuePath: "venue.name",
    statusPath: "status",
    externalIdPath: "id",
  });
  const result = parseJsonEvents(fixture("fixtures-events.json"), mapping);

  it("maps fixtures, joining home and away into the title", () => {
    expect(result.items).toHaveLength(4);
    expect(result.skipped).toBe(3); // no team names, no id, not an object
    expect(result.items[0]).toEqual({
      externalId: "90001",
      title: "Northbridge FC vs Riverside United",
      startsAt: "2026-10-10T14:00:00.000Z",
      endsAt: "2026-10-10T15:55:00.000Z",
      competition: "Example Premier Division",
      venue: "Northbridge Park",
      status: "finished",
    });
  });

  it("handles epoch kick-offs, string ids and provider status vocabularies", () => {
    expect(result.items[1]).toMatchObject({ externalId: "90002", startsAt: "2026-10-13T14:00:00.000Z", status: "scheduled", endsAt: null });
    expect(result.items[2]).toMatchObject({ status: "postponed", venue: null });
  });

  it("drops an end before the start and leaves unknown values empty instead of guessing", () => {
    expect(result.items[2]).toMatchObject({ startsAt: "2026-10-11T17:45:00.000Z", endsAt: null });
    expect(result.items[3]).toMatchObject({ startsAt: null, status: null, title: "Southport Town vs Lakeside FC" });
  });

  it("derives a stable key when no id path is mapped", () => {
    const noIds = parseJsonEvents(fixture("fixtures-events.json"), { ...mapping, externalIdPath: undefined });
    const again = parseJsonEvents(fixture("fixtures-events.json"), { ...mapping, externalIdPath: undefined });
    expect(noIds.items).toHaveLength(5);
    expect(noIds.items[4].externalId).toMatch(/^h:[0-9a-f]{32}$/);
    expect(noIds.items.map((i) => i.externalId)).toEqual(again.items.map((i) => i.externalId));
  });
});

describe("mapEventStatus", () => {
  it("normalizes common provider codes", () => {
    expect(mapEventStatus("FT")).toBe("finished");
    expect(mapEventStatus("in_play")).toBe("live");
    expect(mapEventStatus("IN-PROGRESS")).toBe("live");
    expect(mapEventStatus("HT")).toBe("live");
    expect(mapEventStatus("Not Started")).toBe("scheduled");
    expect(mapEventStatus("PST")).toBe("postponed");
    expect(mapEventStatus("Canceled")).toBe("cancelled");
    expect(mapEventStatus("abandoned")).toBe("cancelled");
    expect(mapEventStatus("something else")).toBeNull();
    expect(mapEventStatus(null)).toBeNull();
    expect(mapEventStatus(3)).toBeNull();
  });
});
