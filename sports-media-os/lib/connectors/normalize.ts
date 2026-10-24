import { createHash } from "node:crypto";

/**
 * Normalization shared by every connector: canonical URLs (dedupe key),
 * content hashes (cross-publisher dedupe), dates and plain-text cleanup.
 * Pure functions — no I/O.
 */

/** Query parameters that only track clicks: dropped from canonical URLs. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
]);

/**
 * Canonical form of an article URL: lowercase scheme/host, no default port,
 * no credentials, no fragment, no tracking parameters (utm_*, fbclid, gclid…),
 * remaining parameters sorted, no trailing slash (except the root).
 * Relative URLs resolve against `base`. Returns null for anything but http(s).
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.username = "";
  url.password = "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  const kept = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    return !k.startsWith("utm_") && !TRACKING_PARAMS.has(k);
  });
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = new URLSearchParams(kept).toString();

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  const href = url.href;
  return href.length <= 2048 ? href : null;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
  times: "×",
  frac12: "½",
  shy: "",
  zwnj: "",
  zwj: "",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  ograve: "ò",
  uacute: "ú",
  ugrave: "ù",
  ntilde: "ñ",
  ccedil: "ç",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  Eacute: "É",
};

/** Decodes HTML character references (named subset + all numeric). Unknown names stay as-is. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** ASCII-only lowercase: same length as the input, so indices stay aligned (unlike toLowerCase on "İ"). */
export function asciiLower(input: string): string {
  return input.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

const HIDDEN_BLOCK = /<!--|<(script|style|noscript|iframe|template)\b/g;

/** Drops comments and script/style-like blocks in one forward pass (unclosed → rest dropped). */
function removeHiddenBlocks(input: string): string {
  const lower = asciiLower(input);
  let out = "";
  let from = 0;
  HIDDEN_BLOCK.lastIndex = 0;
  for (let m = HIDDEN_BLOCK.exec(lower); m; m = HIDDEN_BLOCK.exec(lower)) {
    out += `${input.slice(from, m.index)} `;
    const closing = m[0] === "<!--" ? "-->" : `</${m[1]}`;
    const close = lower.indexOf(closing, m.index + m[0].length);
    if (close < 0) return out;
    const gt = closing === "-->" ? close + 2 : lower.indexOf(">", close);
    from = gt < 0 ? lower.length : gt + 1;
    HIDDEN_BLOCK.lastIndex = from;
  }
  return out + input.slice(from);
}

/** Removes markup: script/style/comment content entirely, tags become spaces. Linear time. */
export function stripHtml(input: string): string {
  return removeHiddenBlocks(input)
    .replace(/<\/?[a-z][^<>]*>/gi, " ")
    .replace(/<!\[CDATA\[|\]\]>/g, " ");
}

/** Shortens at a word boundary and marks the cut with "…". */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** raw input considered by cleanText: bounds regex work on hostile 2 MB fields */
const RAW_TEXT_LIMIT = 20_000;

/**
 * Plain text from feed/API content: HTML stripped, entities decoded (twice:
 * feeds often double-encode), control characters removed, whitespace collapsed.
 * Only the first RAW_TEXT_LIMIT characters are read. Empty → null.
 */
export function cleanText(value: unknown, max?: number): string | null {
  if (value === null || value === undefined) return null;
  let s = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  if (!s) return null;
  s = s.slice(0, RAW_TEXT_LIMIT);
  s = decodeEntities(stripHtml(s));
  // second pass for double-encoded markup/entities ("&amp;lt;b&amp;gt;", "&amp;#8217;")
  if (/[<&]/.test(s)) s = decodeEntities(stripHtml(s));
  s = s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return max ? truncate(s, max) : s;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/** Lowercase, NFKC, letters/digits only (punctuation and dashes don't matter). */
export function normalizeForHash(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * sha256 of the normalized title + summary: the same story syndicated under
 * different URLs (or with tracking parameters) gets the same hash.
 */
export function contentHash(title: string | null | undefined, summary: string | null | undefined): string {
  return createHash("sha256").update(`${normalizeForHash(title)}\n${normalizeForHash(summary)}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** RFC 822 zone names that Date.parse does not know. Offsets in minutes. */
const ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  BST: 60,
  IST: 60,
  CET: 60,
  CEST: 120,
  MET: 60,
  MEST: 120,
  EET: 120,
  EEST: 180,
  WET: 0,
  WEST: 60,
  MSK: 180,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AEST: 600,
  AEDT: 660,
  JST: 540,
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MIN_TIME = Date.UTC(1990, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

function rfc822(input: string): number | null {
  // [Tue, ]07 Oct 2026 19:45[:00] [GMT|+0200|CEST]
  const m = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([a-z]{1,5}|[+-]\d{2}:?\d{2})?$/i.exec(
    input.trim(),
  );
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  let year = Number(m[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  let offset = 0;
  const zone = m[7];
  if (zone) {
    if (/^[+-]/.test(zone)) {
      const digits = zone.replace(":", "");
      offset = (zone[0] === "-" ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
    } else {
      const known = ZONES[zone.toUpperCase()];
      if (known === undefined) return null;
      offset = known;
    }
  }
  return Date.UTC(year, month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - offset * 60_000;
}

/**
 * ISO 8601, RFC 822/1123 (with named zones), epoch seconds or milliseconds →
 * ISO string. Unparseable or implausible (before 1990 / after 2100) → null.
 */
export function parseDate(value: unknown): string | null {
  let time: number | null = null;
  if (value instanceof Date) time = value.getTime();
  else if (typeof value === "number" && Number.isFinite(value)) time = value < 1e11 ? value * 1000 : value;
  else if (typeof value === "string") {
    const s = value.trim();
    if (!s || s.length > 100) return null;
    if (/^\d{9,13}$/.test(s)) time = Number(s) < 1e11 ? Number(s) * 1000 : Number(s);
    else {
      time = rfc822(s);
      if (time === null) {
        // ISO date-time without a zone: read as UTC, never as the server's local time
        const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
        const parsed = Date.parse(iso);
        time = Number.isNaN(parsed) ? null : parsed;
      }
    }
  }
  if (time === null || Number.isNaN(time) || time < MIN_TIME || time > MAX_TIME) return null;
  return new Date(time).toISOString();
}
