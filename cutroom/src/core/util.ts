export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** FNV-1a → base36. Deterministic ids keep React keys and version diffs stable across regenerations. */
export function hashId(prefix: string, ...parts: (string | number)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

/** Ensures ids are unique within a list (appends -2, -3 … on collision). */
export function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = seen.get(it.id) ?? 0;
    seen.set(it.id, n + 1);
    return n === 0 ? it : { ...it, id: `${it.id}-${n + 1}` };
  });
}

/** mulberry32: small seeded PRNG so "Try another version" is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Span {
  start: number;
  end: number;
}

/** Merge overlapping/adjacent spans (gap ≤ tolerance). Input need not be sorted. */
export function mergeSpans<T extends Span>(spans: T[], tolerance = 0): Span[] {
  const s = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end + tolerance) last.end = Math.max(last.end, x.end);
    else out.push({ start: x.start, end: x.end });
  }
  return out;
}

/** a minus b for span lists. */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  let res = mergeSpans(a);
  for (const cut of mergeSpans(b)) {
    const next: Span[] = [];
    for (const r of res) {
      if (cut.end <= r.start || cut.start >= r.end) next.push(r);
      else {
        if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
        if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
      }
    }
    res = next;
  }
  return res;
}

export const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
export const spanLen = (s: Span) => s.end - s.start;
export const totalLen = (s: Span[]) => s.reduce((acc, x) => acc + spanLen(x), 0);
