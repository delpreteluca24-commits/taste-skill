import type { CaptionSettings, ClipItem, EditContext, SubtitleItem, SubtitleWord, Timeline } from '../timeline';
import { isAlertWord, isNumberLike, isProperNounCandidate } from '../text';
import { hashId, round } from '../util';
import { isDropped } from './transcriptClean';

/** Characters that fit on one caption line at a given font size (Montserrat ExtraBold ≈ 0.62 em/char). */
export const charsPerLine = (fontSize: number, width = 1080, safe = 0.84) => Math.floor((width * safe) / (fontSize * 0.62));

interface MappedWord extends SubtitleWord {
  clipId: string;
  source: string;
  srcStart: number;
  raw: string;
  prevRaw?: string;
}

/** Words that survive the edit, mapped to output time. */
export function mapWords(ctx: EditContext, clips: ClipItem[], overrides: Record<string, string>, keepFillers: boolean): MappedWord[] {
  const out: MappedWord[] = [];
  for (const c of clips) {
    const a = ctx.analyses[c.source];
    const words = a?.raw.transcript?.words ?? [];
    const { srcStart, srcEnd, speed } = c.properties;
    words.forEach((w, i) => {
      const mid = (w.start + w.end) / 2;
      if (mid < srcStart || mid > srcEnd || isDropped(w)) return;
      if (!keepFillers && w.flags.includes('filler')) return;
      const text = overrides[w.id] ?? w.text;
      if (!text.trim()) return;
      const s = c.start + (Math.max(w.start, srcStart) - srcStart) / speed;
      const e = c.start + (Math.min(w.end, srcEnd) - srcStart) / speed;
      out.push({ id: w.id, text, start: round(s), end: round(Math.max(e, s + 0.05)), emphasis: false, clipId: c.id, source: c.source, srcStart: w.start, raw: w.text, prevRaw: words[i - 1]?.text });
    });
  }
  return out;
}

/**
 * Subtitle Agent: 2–5 word groups, broken on punctuation, pauses, line width and clip/source changes.
 * At most one emphasized word per group, and only for numbers, money, alert words, names.
 */
export function buildSubtitles(ctx: EditContext, t: Pick<Timeline, 'clips' | 'wordOverrides' | 'duration'>, cs: CaptionSettings, keepFillers: boolean): SubtitleItem[] {
  if (!cs.enabled) return [];
  const words = mapWords(ctx, t.clips, t.wordOverrides, keepFillers);
  const maxChars = charsPerLine(cs.fontSize) * 2 - 2;
  const groups: MappedWord[][] = [];
  let cur: MappedWord[] = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const chars = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
      const sentenceEnd = /[.!?…]$/.test(prev.text);
      const softBreak = /[,;:]$/.test(prev.text) && cur.length >= cs.minWords;
      if (cur.length >= cs.maxWords || chars > maxChars || w.start - prev.end > 0.4 || sentenceEnd || softBreak || prev.source !== w.source) flush();
    }
    cur.push(w);
  }
  flush();

  let emphasized = 0;
  return groups.map((g, gi) => {
    const next = groups[gi + 1];
    const start = g[0].start;
    // Hold until the next group if the gap is short → no flicker between groups.
    const hold = next && next[0].start - g[g.length - 1].end < 0.6 ? next[0].start : g[g.length - 1].end + 0.35;
    const end = round(Math.min(hold, t.duration));
    let emphIdx = -1;
    if (cs.emphasis && emphasized / Math.max(1, gi) < 0.4) {
      emphIdx = g.findIndex((w) => isNumberLike(w.raw) || isAlertWord(w.raw));
      if (emphIdx < 0) emphIdx = g.findIndex((w) => isProperNounCandidate(w.raw, w.prevRaw));
      if (emphIdx >= 0) emphasized++;
    }
    const ws: SubtitleWord[] = g.map((w, i) => ({ id: w.id, text: w.text, start: w.start, end: w.end, emphasis: i === emphIdx }));
    return {
      id: hashId('sub', g[0].clipId, g[0].id),
      type: 'subtitle' as const,
      source: g[0].source,
      start,
      end: Math.max(end, round(start + 0.3)),
      layer: 3,
      reason: emphIdx >= 0 ? `Evidenziata "${g[emphIdx].text}"` : 'Sottotitolo sincronizzato al parlato',
      properties: { words: ws },
    };
  });
}

export const subtitleText = (s: SubtitleItem) => s.properties.words.map((w) => w.text).join(' ');
