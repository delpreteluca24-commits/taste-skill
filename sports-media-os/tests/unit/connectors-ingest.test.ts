import { describe, expect, it } from "vitest";

import { eventChanges, namespacedExternalId, prepareEventRows, prepareSourceRows, type IngestConnector } from "@/lib/connectors/ingest";
import { contentHash } from "@/lib/connectors/normalize";
import type { EventItem, FeedItem } from "@/lib/connectors/types";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const connector: IngestConnector = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Example Sport News",
  kind: "rss",
  url: "https://news.example.com/football/rss.xml",
  target: "sources",
  sport_id: "33333333-3333-4333-8333-333333333333",
  credibility: 0.8,
  default_license: "unknown",
};

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  title: "Northbridge stun Riverside",
  url: "https://news.example.com/a?utm_source=rss",
  publishedAt: "2026-10-07T20:55:00.000Z",
  summary: "Late winner.",
  author: "Sam Reporter",
  categories: ["Premier Division"],
  guid: "nb-1",
  ...over,
});

const NOW = new Date("2026-10-08T00:00:00Z");

describe("prepareSourceRows", () => {
  it("builds a rights-first source row: link, title, summary, unchecked rights", () => {
    const { rows, duplicates, errors } = prepareSourceRows(PROJECT, connector, [item()], NOW);
    expect({ duplicates, errors }).toEqual({ duplicates: 0, errors: 0 });
    expect(rows[0]).toEqual({
      project_id: PROJECT,
      connector_id: connector.id,
      sport_id: connector.sport_id,
      name: "Example Sport News",
      title: "Northbridge stun Riverside",
      url: "https://news.example.com/a",
      source_type: "rss",
      published_at: "2026-10-07T20:55:00.000Z",
      retrieved_at: "2026-10-08T00:00:00.000Z",
      summary: "Late winner.",
      author: "Sam Reporter",
      credibility: 0.8,
      license_status: "unknown",
      content_hash: contentHash("Northbridge stun Riverside", "Late winner."),
      metadata: { ingested_by: "connector", categories: ["Premier Division"], guid: "nb-1" },
    });
    // rights are never set by ingestion: the DB default (unchecked) applies
    expect(rows[0]).not.toHaveProperty("rights_status");
    expect(rows[0]).not.toHaveProperty("usable_in_production");
  });

  it("uses source_type 'api' for JSON API connectors", () => {
    const { rows } = prepareSourceRows(PROJECT, { ...connector, kind: "json_api" }, [item()], NOW);
    expect(rows[0].source_type).toBe("api");
  });

  it("dedupes within a batch by canonical URL and by content hash", () => {
    const { rows, duplicates } = prepareSourceRows(
      PROJECT,
      connector,
      [
        item(),
        item({ url: "https://NEWS.example.com/a#top" }), // same canonical URL
        item({ url: "https://mirror.example.net/b" }), // same title + summary → same hash
        item({ url: "https://news.example.com/c", title: "Different story" }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.url)).toEqual(["https://news.example.com/a", "https://news.example.com/c"]);
    expect(duplicates).toBe(2);
  });

  it("counts unusable items as errors and drops implausible future dates", () => {
    const { rows, errors } = prepareSourceRows(
      PROJECT,
      connector,
      [item({ url: "ftp://x.example.com/1" }), item({ url: "https://x.example.com/2", title: null, summary: null }), item({ publishedAt: "2026-12-01T00:00:00.000Z" })],
      NOW,
    );
    expect(errors).toBe(2);
    expect(rows[0].published_at).toBeNull();
  });

  it("truncates the publisher name to the column limit", () => {
    const { rows } = prepareSourceRows(PROJECT, { ...connector, name: "N".repeat(250) }, [item()], NOW);
    expect(rows[0].name).toHaveLength(200);
  });
});

const event = (over: Partial<EventItem> = {}): EventItem => ({
  externalId: "90001",
  title: "Northbridge FC vs Riverside United",
  startsAt: "2026-10-10T14:00:00.000Z",
  endsAt: "2026-10-10T15:55:00.000Z",
  competition: "Example Premier Division",
  venue: "Northbridge Park",
  status: "scheduled",
  ...over,
});

describe("prepareEventRows", () => {
  const api = { ...connector, kind: "json_api" as const, target: "events", url: "https://api.example.com/v1/fixtures?league=1" };

  it("namespaces provider ids by API host", () => {
    expect(namespacedExternalId(api.url, "90001")).toBe("api.example.com:90001");
    const { rows } = prepareEventRows(PROJECT, api, [event()]);
    expect(rows[0]).toMatchObject({
      project_id: PROJECT,
      connector_id: api.id,
      sport_id: api.sport_id,
      external_id: "api.example.com:90001",
      title: "Northbridge FC vs Riverside United",
      status: "scheduled",
    });
  });

  it("dedupes repeated ids and leaves an unknown status to the DB default", () => {
    const { rows, duplicates, errors } = prepareEventRows(PROJECT, api, [event(), event({ title: "Again" }), event({ externalId: "90002", status: null }), event({ externalId: " ", title: "x" })]);
    expect(rows).toHaveLength(2);
    expect(duplicates).toBe(1);
    expect(errors).toBe(1);
    expect(rows[1]).not.toHaveProperty("status");
  });

  it("never writes an end before the start", () => {
    const { rows } = prepareEventRows(PROJECT, api, [event({ endsAt: "2026-10-10T13:00:00.000Z" })]);
    expect(rows[0].ends_at).toBeNull();
  });
});

describe("eventChanges", () => {
  const stored = {
    title: "Northbridge FC vs Riverside United",
    starts_at: "2026-10-10T14:00:00+00:00",
    ends_at: null,
    competition: "Example Premier Division",
    venue: "Northbridge Park",
    status: "scheduled" as const,
  };

  it("reports nothing when only the timestamp format differs", () => {
    const { rows } = prepareEventRows(PROJECT, { ...connector, target: "events" }, [event({ endsAt: null })]);
    expect(eventChanges(stored, rows[0])).toEqual({});
  });

  it("reports changed fields and ignores a missing status", () => {
    const { rows } = prepareEventRows(PROJECT, { ...connector, target: "events" }, [
      event({ endsAt: null, status: "finished", venue: "New Ground" }),
      event({ externalId: "2", endsAt: null, status: null }),
    ]);
    expect(eventChanges(stored, rows[0])).toEqual({ status: "finished", venue: "New Ground" });
    expect(eventChanges(stored, rows[1])).toEqual({});
  });
});
