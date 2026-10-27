import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cleanAuthor, parseFeed } from "@/lib/connectors/parse-rss";
import { ConnectorParseError } from "@/lib/connectors/types";

const fixture = (name: string, encoding: string = "utf-8") =>
  new TextDecoder(encoding).decode(readFileSync(new URL(`../fixtures/rss/${name}`, import.meta.url)));

describe("parseFeed — RSS 2.0", () => {
  const feed = parseFeed(fixture("football-rss2.xml"), { baseUrl: "https://news.example.com/football/rss.xml" });

  it("detects the format and channel title", () => {
    expect(feed.format).toBe("rss");
    expect(feed.title).toBe("Example Sport News — Football");
  });

  it("keeps good items and skips the broken ones (no title/summary, non-http link)", () => {
    expect(feed.items).toHaveLength(5);
    expect(feed.skipped).toBe(2);
    expect(feed.items.map((i) => i.url)).not.toContain("javascript:alert(1)");
  });

  it("maps title, link, date, author, categories and a cleaned summary", () => {
    const [first] = feed.items;
    expect(first).toEqual({
      title: "Northbridge stun Riverside with 94th-minute winner",
      url: "https://news.example.com/football/articles/northbridge-riverside?utm_source=rss&utm_medium=feed#comments",
      publishedAt: "2026-10-07T20:55:00.000Z",
      summary: "Ten-man Northbridge came from behind to beat Riverside 2–1 & move top of the table.",
      author: "Sam Reporter",
      categories: ["Premier Division", "Northbridge FC"], // case-insensitive dedupe
      guid: "nb-rv-20261007",
    });
  });

  it("prefers the publisher excerpt and never returns the full article body", () => {
    for (const item of feed.items) {
      expect(item.summary ?? "").not.toMatch(/FULL ARTICLE BODY/);
      expect((item.summary ?? "").length).toBeLessThanOrEqual(500);
      expect(item.summary ?? "").not.toMatch(/<[a-z]/i);
    }
  });

  it("decodes entity-escaped HTML, typographic entities and RFC 822 named zones", () => {
    const item = feed.items[1];
    expect(item.title).toBe("Coach: “We deserved more” after Harbour City draw");
    expect(item.summary).toBe("Harbour City’s coach said his side dominated possession …");
    expect(item.author).toBe("Alex Writer"); // e-mail removed
    expect(item.publishedAt).toBe("2026-10-07T17:30:00.000Z"); // 19:30 CEST
  });

  it("falls back to a permalink guid and resolves relative links", () => {
    expect(feed.items[2].url).toBe("https://news.example.com/football/articles/riverside-defender");
    expect(feed.items[2].publishedAt).toBe("2026-10-07T17:00:00.000Z");
    expect(feed.items[3].url).toBe("https://news.example.com/football/articles/northbridge-captain-injury");
    expect(feed.items[3].publishedAt).toBeNull();
  });
});

describe("parseFeed — Atom", () => {
  const feed = parseFeed(fixture("tennis-atom.xml"), { baseUrl: "https://tennis.example.org/feed.atom" });

  it("reads entries, alternate links (not enclosures) and xml:base", () => {
    expect(feed.format).toBe("atom");
    expect(feed.title).toBe("Example Tennis Wire");
    expect(feed.items).toHaveLength(2);
    expect(feed.skipped).toBe(1);
    expect(feed.items[0].url).toBe("https://tennis.example.org/2026/10/07/qualifier-semi-final");
  });

  it("decodes html titles, uses published over updated, author name and category labels", () => {
    const [entry] = feed.items;
    expect(entry.title).toBe("Qualifier & wildcard reach semi-final");
    expect(entry.publishedAt).toBe("2026-10-07T14:45:00.000Z");
    expect(entry.author).toBe("Jordan Court");
    expect(entry.categories).toEqual(["ATP 250", "upsets"]);
    expect(entry.summary).toBe("The world No. 212 saved four match points.");
  });

  it("keeps word order in xhtml content and uses a URL id as link", () => {
    const entry = feed.items[1];
    expect(entry.url).toBe("https://tennis.example.org/2026/10/06/fastest-serve");
    expect(entry.summary).toBe("A 247 km/h serve was recorded in the second set.");
    expect(entry.publishedAt).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("parseFeed — RDF / RSS 1.0", () => {
  const feed = parseFeed(fixture("cycling-rdf.xml", "iso-8859-1"));

  it("reads items next to the channel, rdf:about links and Dublin Core fields", () => {
    expect(feed.format).toBe("rdf");
    expect(feed.title).toBe("Example Cycling Daily");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      url: "https://cycling.example.net/stage-12-report",
      publishedAt: "2026-10-07T15:20:00.000Z",
      author: "Example Cycling Desk",
      categories: ["Grand Tour"],
    });
    expect(feed.items[1].url).toBe("https://cycling.example.net/rider-abandons"); // from rdf:about
    expect(feed.items[1].publishedAt).toBe("2026-10-07T11:05:00.000Z");
  });
});

describe("parseFeed — hostile and invalid documents", () => {
  it("does not expand DOCTYPE entities (billion laughs / XXE)", () => {
    const feed = parseFeed(fixture("entity-bomb.xml"));
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title?.length).toBeLessThan(100);
    expect(feed.items[0].title).not.toMatch(/root:|aaaaaaaaaa/);
  });

  it("rejects documents that are not feeds", () => {
    expect(() => parseFeed(fixture("not-a-feed.html"))).toThrow(ConnectorParseError);
    expect(() => parseFeed("")).toThrow(/Empty/);
    expect(() => parseFeed('{"items":[]}')).toThrow(/Not XML/);
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow(/Not an RSS/);
  });

  it("survives items with unexpected shapes", () => {
    const xml = `<rss version="2.0"><channel><title>T</title>
      <item><title><b>Bold</b> headline</title><link>https://x.example.com/1</link></item>
      <item><title></title><link></link></item>
      <item>plain text item</item>
      <item><title>Only guid</title><guid>not-a-url</guid></item>
      <item><title>Dated</title><link>https://x.example.com/2</link><pubDate>garbage</pubDate><category/></item>
    </channel></rss>`;
    const feed = parseFeed(xml);
    expect(feed.items.map((i) => i.title)).toEqual(["Bold headline", "Dated"]);
    expect(feed.items[1]).toMatchObject({ publishedAt: null, categories: [] });
    expect(feed.skipped).toBe(3);
  });

  it("parses a single-item channel and caps the number of items", () => {
    const items = Array.from({ length: 5 }, (_, i) => `<item><title>T${i}</title><link>https://x.example.com/${i}</link></item>`).join("");
    const feed = parseFeed(`<rss><channel>${items}</channel></rss>`, { maxItems: 3 });
    expect(feed.items).toHaveLength(3);
    expect(parseFeed(`<rss><channel><item><title>One</title><link>https://x.example.com/1</link></item></channel></rss>`).items).toHaveLength(1);
  });
});

describe("cleanAuthor", () => {
  it("keeps names, removes bare e-mail addresses and bylines", () => {
    expect(cleanAuthor("desk@news.example.com (Alex Writer)")).toBe("Alex Writer");
    expect(cleanAuthor("By Casey Analyst")).toBe("Casey Analyst");
    expect(cleanAuthor("newsdesk@hoops.example.com")).toBeNull();
    expect(cleanAuthor("Sam (Senior Writer)")).toBe("Sam (Senior Writer)");
    expect(cleanAuthor("  ")).toBeNull();
    expect(cleanAuthor(null)).toBeNull();
  });
});
