/**
 * Text helpers shared by hook scoring (lib/scoring/hook.ts) and script
 * grounding (lib/scripts/grounding.ts). Pure: no DB, no AI.
 *
 * Everything here is deliberately simple and explainable — it backs warnings
 * a producer reads ("“23” is not in any provided fact"), not hidden judgements.
 */

/** Lowercase, strip accents and punctuation, collapse whitespace ("Mbappé’s" → "mbappe s"). */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}'%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words as a viewer reads them (punctuation at the edges removed). */
export function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, ""))
    .filter((w) => w.length > 0);
}

export function wordCount(text: string): number {
  return words(text).length;
}

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

/**
 * Canonical form of a numeric token so "1,000", "1.000" and "1000" match, and
 * "2,5" matches "2.5". Leading zeros go ("07" → "7").
 */
export function canonicalNumber(token: string): string | null {
  // thousands separators: a separator followed by exactly three digits
  let t = token.replace(/[.,](?=\d{3}(?:\D|$))/g, "");
  t = t.replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

/** Every number written with digits in the text, canonical and unique, in order of appearance. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const c = canonicalNumber(match[0]);
    if (c !== null && !out.includes(c)) out.push(c);
  }
  return out;
}

/** All numbers that appear in any of the texts (the "allowed" set for grounding). */
export function numberSet(texts: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const t of texts) for (const n of extractNumbers(t)) set.add(n);
  return set;
}

/** Text between double quotation marks (“…”, "…", «…», „…“) with at least `minWords` words. */
export function extractQuotations(text: string, minWords = 3): string[] {
  const out: string[] = [];
  const patterns = [/“([^”]+)”/g, /"([^"]+)"/g, /«\s*([^»]+?)\s*»/g, /„([^“”]+)[“”]/g];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const inner = m[1].trim();
      if (wordCount(inner) >= minWords && !out.includes(inner)) out.push(inner);
    }
  }
  return out;
}

/** Shorten for a warning or a chip ("…" when cut). */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
