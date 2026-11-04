import { describe, expect, it } from "vitest";

import { asciiLower, cleanText, parseDate } from "@/lib/connectors/normalize";
import { parseFeed, protectInlineMarkup, stripDoctype } from "@/lib/connectors/parse-rss";
import { cleanValidator } from "@/lib/net/safe-fetch";

/**
 * A connector fetches untrusted documents (up to 2 MB). Parsing must stay
 * linear: no pattern may rescan the rest of the document per unclosed tag.
 */
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

describe("hostile feeds stay fast", () => {
  it("many unclosed <title> tags", () => {
    const xml = `<rss><channel>${"<title>x".repeat(200_000)}</channel></rss>`;
    expect(timed(() => protectInlineMarkup(xml)).ms).toBeLessThan(1000);
    expect(timed(() => { try { parseFeed(xml); } catch { /* malformed is fine */ } }).ms).toBeLessThan(3000);
  });

  it("many unterminated DOCTYPE internal subsets", () => {
    const xml = `${"<!DOCTYPE a [".repeat(100_000)}<rss/>`;
    const { value, ms } = timed(() => stripDoctype(xml));
    expect(ms).toBeLessThan(1000);
    expect(value).toBe(""); // unterminated: the rest is dropped
  });

  it("descriptions full of unclosed comments, scripts and tags", () => {
    for (const piece of ["<!--", "<script>", "<a", "<b x='1'"]) {
      const { ms } = timed(() => cleanText(piece.repeat(400_000), 500));
      expect(ms, piece).toBeLessThan(1000);
    }
  });

  it("overlong date strings are rejected without parsing", () => {
    expect(parseDate(`Wed, 07 Oct 2026 ${" ".repeat(10_000)}19:45 GMT`)).toBeNull();
  });
});

describe("stripDoctype", () => {
  it("removes internal subsets and external DTD references, keeps the document", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "x">]><rss version="2.0"/>`;
    expect(stripDoctype(xml)).toBe(`<?xml version="1.0"?><rss version="2.0"/>`);
    expect(stripDoctype(`<!doctype rss PUBLIC "-//X//EN" "http://x/dtd"><rss/>`)).toBe("<rss/>");
    expect(stripDoctype("<rss/>")).toBe("<rss/>");
  });
});

describe("protectInlineMarkup", () => {
  it("wraps inline markup of text elements in CDATA and leaves the rest", () => {
    expect(protectInlineMarkup("<item><description>Hi <b>there</b></description></item>")).toBe(
      "<item><description><![CDATA[Hi <b>there</b>]]></description></item>",
    );
    expect(protectInlineMarkup("<title>Plain</title>")).toBe("<title>Plain</title>");
    expect(protectInlineMarkup("<summary><![CDATA[<p>x</p>]]></summary>")).toBe("<summary><![CDATA[<p>x</p>]]></summary>");
    expect(protectInlineMarkup('<content src="https://x.example.com/a"/><title>T</title>')).toBe('<content src="https://x.example.com/a"/><title>T</title>');
    // media:* blocks keep their structure
    expect(protectInlineMarkup("<media:content><media:title>T</media:title></media:content>")).toBe(
      "<media:content><media:title>T</media:title></media:content>",
    );
  });

  it("escapes a CDATA terminator inside the wrapped markup", () => {
    const out = protectInlineMarkup("<description>a <i>]]></i> b</description>");
    expect(out).toBe("<description><![CDATA[a <i>]]]]><![CDATA[></i> b]]></description>");
  });
});

describe("index-safe helpers", () => {
  it("asciiLower preserves length on non-ASCII input", () => {
    const s = "İSTANBUL <TITLE>";
    expect(asciiLower(s)).toHaveLength(s.length);
    expect(asciiLower(s)).toBe("İstanbul <title>");
  });

  it("cleanValidator keeps only printable ASCII validators", () => {
    expect(cleanValidator('W/"abc-123"')).toBe('W/"abc-123"');
    expect(cleanValidator(" Wed, 07 Oct 2026 21:10:00 GMT ")).toBe("Wed, 07 Oct 2026 21:10:00 GMT");
    expect(cleanValidator('"bad\r\nInjected: 1"')).toBeNull();
    expect(cleanValidator('"ünïcode"')).toBeNull();
    expect(cleanValidator("x".repeat(600))).toBeNull();
    expect(cleanValidator(null)).toBeNull();
  });
});
