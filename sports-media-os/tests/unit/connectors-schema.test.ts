import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectorFormSchema, readConnectorForm, toConnectorConfig } from "@/lib/connectors/schema";

const base = {
  name: "Example Sport News",
  kind: "rss",
  url: "https://news.example.com/football/rss.xml",
  target: "sources",
  enabled: true,
};

const errorsOf = (input: Record<string, unknown>) => {
  const r = connectorFormSchema.safeParse(input);
  return r.success ? {} : z.flattenError(r.error).fieldErrors;
};

describe("connectorFormSchema", () => {
  it("accepts a minimal RSS connector with defaults", () => {
    const parsed = connectorFormSchema.parse(base);
    expect(parsed).toMatchObject({ kind: "rss", target: "sources", defaultLicense: "unknown", fetchIntervalMinutes: 60, enabled: true });
    expect(parsed.credibility).toBeUndefined();
    expect(toConnectorConfig(parsed)).toEqual({});
  });

  it("validates name, URL, credibility and interval bounds", () => {
    expect(errorsOf({ ...base, name: " " }).name).toBeDefined();
    expect(errorsOf({ ...base, url: "ftp://example.com/feed" }).url).toBeDefined();
    expect(errorsOf({ ...base, url: "example.com/feed" }).url).toBeDefined();
    expect(errorsOf({ ...base, credibility: "1.5" }).credibility).toBeDefined();
    expect(errorsOf({ ...base, credibility: "-0.1" }).credibility).toBeDefined();
    expect(errorsOf({ ...base, fetchIntervalMinutes: "5" }).fetchIntervalMinutes).toBeDefined();
    expect(errorsOf({ ...base, fetchIntervalMinutes: "1441" }).fetchIntervalMinutes).toBeDefined();
    expect(errorsOf({ ...base, fetchIntervalMinutes: "30.5" }).fetchIntervalMinutes).toBeDefined();
    expect(errorsOf({ ...base, defaultLicense: "stolen" }).defaultLicense).toBeDefined();
    expect(errorsOf({ ...base, sportId: "not-a-uuid" }).sportId).toBeDefined();
    expect(connectorFormSchema.parse({ ...base, credibility: "0.75", fetchIntervalMinutes: "15" })).toMatchObject({ credibility: 0.75, fetchIntervalMinutes: 15 });
  });

  it("does not allow RSS connectors to target events", () => {
    expect(errorsOf({ ...base, target: "events" }).target?.[0]).toMatch(/JSON API for events/);
  });

  it("requires the target's mapping for JSON APIs and reports it per field", () => {
    const errors = errorsOf({ ...base, kind: "json_api" });
    expect(errors.titlePath?.[0]).toMatch(/Required|required/);
    expect(errors.urlPath?.[0]).toMatch(/Required/);
    expect(errorsOf({ ...base, kind: "json_api", target: "events", titlePath: "name" })).toEqual({});
    expect(errorsOf({ ...base, kind: "json_api", titlePath: "t", urlPath: "bad path" }).urlPath).toBeDefined();
  });

  it("stores only the selected target's mapping as config", () => {
    const parsed = connectorFormSchema.parse({
      ...base,
      kind: "json_api",
      target: "events",
      titlePath: "teams.home.name,teams.away.name",
      startsAtPath: "kickoff",
      urlPath: "ignored.for.events",
      itemsPath: "",
    });
    expect(toConnectorConfig(parsed)).toEqual({ titlePath: "teams.home.name,teams.away.name", startsAtPath: "kickoff" });
  });
});

describe("readConnectorForm", () => {
  it("reads strings and maps the enabled checkbox to a boolean", () => {
    const fd = new FormData();
    fd.set("name", "Feed");
    fd.set("kind", "rss");
    fd.set("url", "https://x.example.com/rss");
    fd.set("enabled", "on");
    fd.set("titlePath", "headline");
    expect(readConnectorForm(fd)).toMatchObject({ name: "Feed", kind: "rss", enabled: true, titlePath: "headline", urlPath: undefined });
    fd.delete("enabled");
    expect(readConnectorForm(fd).enabled).toBe(false);
  });
});
