import { XMLParser } from "fast-xml-parser";

import { asciiLower, cleanText, parseDate } from "./normalize";
import { ConnectorParseError, MAX_ITEMS_PER_FETCH, SUMMARY_MAX_LENGTH, type FeedFormat, type FeedItem, type ParseResult } from "./types";

/**
 * RSS 2.0 / 0.9x, Atom 1.0 and RDF (RSS 1.0) → FeedItem[].
 * Namespace prefixes are removed (dc:creator → creator, content:encoded → encoded),
 * so the same lookups work whatever prefix a publisher picked. Robust to
 * missing fields; a broken item is skipped and counted, never fatal.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false, // keep "0123" guids and numeric-looking titles as text
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
  processEntities: { enabled: true, maxEntityCount: 50, maxTotalExpansions: 5000, maxExpandedLength: 1_000_000 },
});

type Node = unknown;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** All text inside a node (attributes excluded), e.g. Atom type="xhtml" content. */
function gatherText(node: Node): string {
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(gatherText).filter(Boolean).join(" ");
  if (isObj(node)) {
    return Object.entries(node)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, value]) => gatherText(value))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** First non-empty text of a possibly repeated element. */
function firstText(node: Node): string | null {
  for (const candidate of asArray(node)) {
    const text = gatherText(candidate).trim();
    if (text) return text;
  }
  return null;
}

function attr(node: Node, name: string): string | null {
  if (!isObj(node)) return null;
  const value = node[`@_${name}`];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Absolute http(s) URL or null (relative links resolve against the feed URL). */
function resolveLink(value: string | null, base: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function pickLink(item: Obj, base: string | undefined): string | null {
  const links = asArray(item.link);
  // RSS <link>text</link>
  for (const link of links) {
    if (typeof link === "string") {
      const url = resolveLink(link, base);
      if (url) return url;
    }
  }
  // Atom / atom:link: rel="alternate" (or no rel) first, then anything with an href
  const withHref = links.filter((l) => attr(l, "href"));
  const preferred = withHref.find((l) => {
    const rel = attr(l, "rel");
    return rel === null || rel === "alternate";
  });
  for (const link of preferred ? [preferred, ...withHref] : withHref) {
    const rel = attr(link, "rel");
    if (rel === "self" || rel === "enclosure" || rel === "replies" || rel === "edit") continue;
    const url = resolveLink(attr(link, "href"), base);
    if (url) return url;
  }
  // RSS <guid> when it is an http(s) URL (permalink or not, it identifies the article)
  for (const guid of asArray(item.guid)) {
    const text = firstText(guid);
    if (text && /^https?:\/\//i.test(text)) return resolveLink(text, base);
  }
  // RDF rdf:about, Atom <id> when it is a URL
  return resolveLink(attr(item, "about"), base) ?? (/^https?:\/\//i.test(firstText(item.id) ?? "") ? resolveLink(firstText(item.id), base) : null);
}

/** "jo@example.com (Jo Bloggs)" → "Jo Bloggs"; a bare e-mail address is not stored. */
export function cleanAuthor(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().slice(0, 500);
  const inParens = /\(([^)]+)\)\s*$/.exec(s);
  if (inParens && /@/.test(s.slice(0, inParens.index))) s = inParens[1];
  s = s.replace(/^by\s+/i, "").trim();
  if (!s || /^[^\s@]+@[^\s@]+$/.test(s)) return null;
  return cleanText(s, 200);
}

function pickAuthor(item: Obj): string | null {
  for (const author of [...asArray(item.author), ...asArray(item.creator)]) {
    const name = isObj(author) && "name" in author ? firstText(author.name) : firstText(author);
    const cleaned = cleanAuthor(name);
    if (cleaned) return cleaned;
  }
  return null;
}

function pickCategories(item: Obj): string[] {
  const seen = new Map<string, string>();
  for (const category of [...asArray(item.category), ...asArray(item.subject)]) {
    const raw = attr(category, "label") ?? attr(category, "term") ?? firstText(category);
    const text = cleanText(raw, 80);
    if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
    if (seen.size >= 20) break;
  }
  return [...seen.values()];
}

function pickDate(item: Obj): string | null {
  for (const key of ["pubDate", "published", "date", "issued", "updated", "modified"]) {
    const date = parseDate(firstText(item[key]));
    if (date) return date;
  }
  return null;
}

function pickSummary(item: Obj): string | null {
  // publisher-provided excerpts first; the full body (content:encoded / content)
  // only as a fallback, cut to a short excerpt — the body itself is never stored
  for (const key of ["description", "summary", "encoded", "content"]) {
    const text = cleanText(firstText(item[key]), SUMMARY_MAX_LENGTH);
    if (text) return text;
  }
  return null;
}

function toItem(raw: unknown, base: string | undefined): FeedItem | null {
  if (!isObj(raw)) return null;
  const url = pickLink(raw, base);
  if (!url) return null;
  const title = cleanText(firstText(raw.title), 300);
  const summary = pickSummary(raw);
  if (!title && !summary) return null;
  const guid = cleanText(firstText(raw.guid) ?? firstText(raw.id), 500);
  return {
    title,
    url,
    publishedAt: pickDate(raw),
    summary,
    author: pickAuthor(raw),
    categories: pickCategories(raw),
    guid,
  };
}

/**
 * Drops DOCTYPE declarations: feeds never need custom entities (billion-laughs /
 * XXE surface). Single forward scan — linear even on hostile input.
 */
export function stripDoctype(xml: string): string {
  const lower = asciiLower(xml);
  let out = "";
  let from = 0;
  for (;;) {
    const start = lower.indexOf("<!doctype", from);
    if (start < 0) break;
    out += xml.slice(from, start);
    const close = xml.indexOf(">", start);
    const bracket = xml.indexOf("[", start);
    let end = close;
    if (bracket >= 0 && (close < 0 || bracket < close)) {
      const subsetEnd = xml.indexOf("]", bracket);
      end = subsetEnd < 0 ? -1 : xml.indexOf(">", subsetEnd);
    }
    if (end < 0) return out; // unterminated: drop the rest (the parser then reports "not a feed")
    from = end + 1;
  }
  return out + xml.slice(from);
}

/** feed text elements that may carry inline (X)HTML; media:* etc. are left alone */
const TEXT_OPEN_TAG = /<((?:atom:|content:)?(?:title|description|summary|content|encoded))(\s[^<>]*)?>/gi;

/**
 * Inline markup inside text elements (Atom type="xhtml", sloppy RSS HTML) would
 * be parsed into child nodes and lose word order; wrapping it in CDATA keeps it
 * as one string that cleanText() strips in order. Already-CDATA content is untouched.
 * Linear: each closing-tag search only moves forward and every region is scanned once.
 */
export function protectInlineMarkup(xml: string): string {
  const lower = asciiLower(xml);
  const nextClose = new Map<string, number>();
  let out = "";
  let last = 0;
  TEXT_OPEN_TAG.lastIndex = 0;
  for (let m = TEXT_OPEN_TAG.exec(xml); m; m = TEXT_OPEN_TAG.exec(xml)) {
    const [open, tag, attrs] = m;
    if (attrs?.endsWith("/")) continue; // self-closing
    const innerStart = m.index + open.length;
    const token = `</${asciiLower(tag)}`;
    let close = nextClose.get(token);
    if (close === undefined || (close >= 0 && close < innerStart)) {
      close = lower.indexOf(token, innerStart);
      nextClose.set(token, close);
    }
    if (close < 0) continue; // never closed (cached: later ones are not either)
    const closeEnd = xml.indexOf(">", close);
    if (closeEnd < 0) continue;
    const inner = xml.slice(innerStart, close);
    if (inner.includes("<") && !inner.includes("<![CDATA[")) {
      out += `${xml.slice(last, m.index)}<${tag}${attrs ?? ""}><![CDATA[${inner.replace(/]]>/g, "]]]]><![CDATA[>")}]]></${tag}>`;
      last = closeEnd + 1;
    }
    TEXT_OPEN_TAG.lastIndex = closeEnd + 1;
  }
  return out + xml.slice(last);
}

/**
 * Parses an RSS / Atom / RDF document. `baseUrl` (the feed URL) resolves relative links.
 * Throws ConnectorParseError when the document is not a feed at all.
 */
export function parseFeed(xml: string, opts: { baseUrl?: string; maxItems?: number } = {}): ParseResult<FeedItem> {
  const source = stripDoctype(xml.replace(/^﻿/, "")).trim();
  if (!source) throw new ConnectorParseError("Empty response: expected an RSS, Atom or RDF feed");
  if (!source.startsWith("<")) throw new ConnectorParseError("Not XML: expected an RSS, Atom or RDF feed");

  let doc: Obj;
  try {
    doc = parser.parse(protectInlineMarkup(source)) as Obj;
  } catch (e) {
    throw new ConnectorParseError(`Malformed XML (${e instanceof Error ? e.message.slice(0, 120) : "parse error"})`);
  }

  let format: FeedFormat;
  let channel: Obj | undefined;
  let rawItems: unknown[];
  let base = opts.baseUrl;

  if (isObj(doc.rss)) {
    format = "rss";
    channel = asArray(doc.rss.channel).find(isObj);
    rawItems = asArray(channel?.item);
  } else if (isObj(doc.feed)) {
    format = "atom";
    channel = doc.feed;
    rawItems = asArray(doc.feed.entry);
    base = resolveLink(attr(doc.feed, "base"), opts.baseUrl) ?? opts.baseUrl;
  } else if (isObj(doc.RDF)) {
    format = "rdf";
    channel = asArray(doc.RDF.channel).find(isObj);
    rawItems = asArray(doc.RDF.item);
    if (rawItems.length === 0) rawItems = asArray(channel?.item);
  } else {
    throw new ConnectorParseError("Not an RSS, Atom or RDF feed");
  }

  const items: FeedItem[] = [];
  let skipped = 0;
  for (const raw of rawItems.slice(0, opts.maxItems ?? MAX_ITEMS_PER_FETCH)) {
    try {
      const item = toItem(raw, base);
      if (item) items.push(item);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  return { format, title: cleanText(firstText(channel?.title), 200), items, skipped };
}
