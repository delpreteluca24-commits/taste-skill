import { describe, expect, it } from "vitest";

import { canonicalizeUrl, cleanText, contentHash, decodeEntities, normalizeForHash, parseDate, stripHtml, truncate } from "@/lib/connectors/normalize";

describe("canonicalizeUrl", () => {
  it("lowercases scheme and host, drops default ports, fragments and credentials", () => {
    expect(canonicalizeUrl("HTTPS://News.Example.COM:443/Football/Story#comments")).toBe("https://news.example.com/Football/Story");
    expect(canonicalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
    expect(canonicalizeUrl("http://example.com:8080/a")).toBe("http://example.com:8080/a");
    expect(canonicalizeUrl("https://user:pw@example.com/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://example.com./a")).toBe("https://example.com/a");
  });

  it("removes utm_*, fbclid, gclid and other click trackers; sorts the rest", () => {
    expect(
      canonicalizeUrl("https://example.com/story?utm_source=rss&utm_Medium=feed&id=7&fbclid=abc&gclid=x&b=2&a=1&mc_cid=z"),
    ).toBe("https://example.com/story?a=1&b=2&id=7");
    expect(canonicalizeUrl("https://example.com/story?utm_campaign=x")).toBe("https://example.com/story");
    expect(canonicalizeUrl("https://example.com/story?ref=home")).toBe("https://example.com/story?ref=home");
  });

  it("strips trailing slashes except the root", () => {
    expect(canonicalizeUrl("https://example.com/news/")).toBe("https://example.com/news");
    expect(canonicalizeUrl("https://example.com/news///")).toBe("https://example.com/news");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("gives the same key to the same article written differently", () => {
    const variants = [
      "https://News.example.com/football/a/?utm_source=x#top",
      "https://news.example.com:443/football/a",
      "https://news.example.com/football/a?fbclid=123",
    ];
    expect(new Set(variants.map((v) => canonicalizeUrl(v))).size).toBe(1);
  });

  it("resolves relative URLs and rejects non-http(s) or invalid input", () => {
    expect(canonicalizeUrl("/news/1", "https://example.com/feed.xml")).toBe("https://example.com/news/1");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("mailto:desk@example.com")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
    expect(canonicalizeUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("contentHash", () => {
  it("is a sha256 hex digest", () => {
    expect(contentHash("Title", "Summary")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores case, punctuation, dashes and whitespace differences", () => {
    const a = contentHash("Northbridge 2-1 Riverside!", "Ten-man   Northbridge win.");
    const b = contentHash("northbridge 2–1 riverside", "Ten man Northbridge win");
    expect(a).toBe(b);
    expect(normalizeForHash("Ｆｕｌｌ　Ｗｉｄｔｈ")).toBe("full width");
  });

  it("changes when the title or the summary changes", () => {
    expect(contentHash("A", "x")).not.toBe(contentHash("B", "x"));
    expect(contentHash("A", "x")).not.toBe(contentHash("A", "y"));
    expect(contentHash("A", null)).toBe(contentHash("A", ""));
  });
});

describe("text cleanup", () => {
  it("strips tags, scripts, styles and comments", () => {
    expect(stripHtml("<p>Hi <b>there</b></p><script>alert(1)</script><style>p{}</style><!-- c -->")).toMatch(/^\s*Hi\s+there\s*$/);
  });

  it("decodes named and numeric entities, leaving unknown names", () => {
    expect(decodeEntities("&amp; &lt; &#8217; &#x2014; &hellip; &nbsp;&unknownentity; &#0;")).toBe("& < ’ — …  &unknownentity; "); // &nbsp; → plain space, &#0; dropped
  });

  it("cleanText handles double-encoded HTML and collapses whitespace", () => {
    expect(cleanText("&lt;p&gt;Club&amp;#8217;s   statement&lt;/p&gt;\n\n")).toBe("Club’s statement");
    expect(cleanText("<p>  </p>")).toBeNull();
    expect(cleanText(42)).toBe("42");
    expect(cleanText({})).toBeNull();
    expect(cleanText(null)).toBeNull();
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(200);
    const out = cleanText(long, 500)!;
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith("…")).toBe(true);
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("one two three four five six", 16)).toBe("one two three…");
    expect(truncate("abcdefghijklmnop", 8)).toBe("abcdefg…"); // no space: hard cut
  });
});

describe("parseDate", () => {
  it("parses ISO 8601 (zone-less as UTC) and RFC 822 with offsets and named zones", () => {
    expect(parseDate("2026-10-07T19:45:00Z")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("2026-10-07T21:45:00+02:00")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("2026-10-07T19:45:00")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("2026-10-07 19:45")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("Wed, 07 Oct 2026 19:45:00 GMT")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("Wed, 07 Oct 2026 21:45:00 +0200")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("Wed, 07 Oct 2026 21:45:00 CEST")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("Wed, 07 Oct 2026 15:45 EDT")).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("7 Oct 26 19:45:00 UT")).toBe("2026-10-07T19:45:00.000Z");
  });

  it("parses epoch seconds and milliseconds", () => {
    expect(parseDate(1791402300)).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate(1791402300000)).toBe("2026-10-07T19:45:00.000Z");
    expect(parseDate("1791402300")).toBe("2026-10-07T19:45:00.000Z");
  });

  it("returns null for garbage and implausible dates", () => {
    for (const bad of ["", "garbage", "Mon, 32 Foo 2026", "1850-01-01T00:00:00Z", "2150-01-01T00:00:00Z", null, undefined, {}, Number.NaN]) {
      expect(parseDate(bad), String(bad)).toBeNull();
    }
    expect(parseDate("Wed, 07 Oct 2026 19:45:00 XYZT")).toBeNull();
  });
});
