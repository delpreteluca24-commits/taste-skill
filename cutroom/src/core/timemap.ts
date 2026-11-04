import type { Anchor, ClipItem, Timeline } from './timeline';
import { round } from './util';

/** Lay clips out back-to-back on the output timeline (no gaps). Mutates nothing. */
export function layoutClips(clips: ClipItem[]): ClipItem[] {
  let t = 0;
  return clips.map((c) => {
    const dur = (c.properties.srcEnd - c.properties.srcStart) / c.properties.speed;
    const out = { ...c, start: round(t), end: round(t + dur) };
    t += dur;
    return out;
  });
}

export const timelineDuration = (clips: ClipItem[]) => (clips.length ? clips[clips.length - 1].end : 0);

/** Output time of a source instant. Prefers story clips over the cold-open teaser copy. */
export function srcToOutput(clips: ClipItem[], mediaId: string, srcTime: number): number | null {
  let fallback: number | null = null;
  for (const c of clips) {
    if (c.source !== mediaId) continue;
    const { srcStart, srcEnd, speed } = c.properties;
    if (srcTime >= srcStart - 1e-6 && srcTime <= srcEnd + 1e-6) {
      const t = c.start + (srcTime - srcStart) / speed;
      if (c.properties.role !== 'hook') return t;
      fallback ??= t;
    }
  }
  return fallback;
}

/** Map a source anchor to an output range: the part of it that survives inside one clip. */
export function mapAnchor(clips: ClipItem[], a: Anchor): { start: number; end: number } | null {
  let best: { start: number; end: number; len: number; hook: boolean } | null = null;
  for (const c of clips) {
    if (c.source !== a.mediaId) continue;
    const { srcStart, srcEnd, speed } = c.properties;
    const s = Math.max(srcStart, a.srcStart);
    const e = Math.min(srcEnd, a.srcEnd);
    if (e - s <= 1e-3 && !(a.srcStart === a.srcEnd && a.srcStart >= srcStart && a.srcStart <= srcEnd)) continue;
    const start = c.start + (s - srcStart) / speed;
    const end = c.start + (Math.max(e, s) - srcStart) / speed;
    const hook = c.properties.role === 'hook';
    const len = end - start;
    // Prefer the non-teaser occurrence, then the longest surviving part.
    if (!best || (best.hook && !hook) || (best.hook === hook && len > best.len)) best = { start, end, len, hook };
  }
  return best ? { start: round(best.start), end: round(best.end) } : null;
}

export function clipAt(clips: ClipItem[], t: number): ClipItem | null {
  for (const c of clips) if (t >= c.start && t < c.end) return c;
  return clips.length && t >= clips[clips.length - 1].end ? clips[clips.length - 1] : null;
}

/** Output range → source ranges per clip (for "cut this part"). */
export function outputRangeToSource(clips: ClipItem[], start: number, end: number) {
  const out: { source: string; start: number; end: number; clipId: string; role: string }[] = [];
  for (const c of clips) {
    const s = Math.max(c.start, start);
    const e = Math.min(c.end, end);
    if (e - s <= 1e-3) continue;
    const { srcStart, speed } = c.properties;
    out.push({
      source: c.source,
      start: round(srcStart + (s - c.start) * speed),
      end: round(srcStart + (e - c.start) * speed),
      clipId: c.id,
      role: c.properties.role,
    });
  }
  return out;
}

/** Re-derive output times of anchored elements after the clip layer changed; drop the ones cut away. */
export function retimeAnchored<T extends { anchor?: Anchor; start: number; end: number }>(clips: ClipItem[], items: T[], minLen = 0.25): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (!it.anchor) {
      out.push(it);
      continue;
    }
    const r = mapAnchor(clips, it.anchor);
    if (!r) continue;
    const origLen = it.end - it.start;
    // Point-like anchors (sfx, zoom start) keep their own duration from the mapped start.
    const end = r.end - r.start < minLen ? r.start + Math.max(origLen, minLen) : r.end;
    out.push({ ...it, start: r.start, end: round(end) });
  }
  return out;
}

export function clampToDuration<T extends { start: number; end: number }>(items: T[], duration: number): T[] {
  return items
    .filter((i) => i.start < duration - 0.05)
    .map((i) => (i.end > duration ? { ...i, end: round(duration) } : i));
}

export const tl = {
  duration: (t: Timeline) => timelineDuration(t.clips),
};
