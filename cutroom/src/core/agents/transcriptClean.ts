import type { Range, Word, WordFlag } from '../timeline';
import { isLeadingMarker, isStopWord, isVocalFiller, norm } from '../text';
import { overlap } from '../util';

const addFlag = (w: Word, f: WordFlag): Word => (w.flags.includes(f) ? w : { ...w, flags: [...w.flags, f] });

/**
 * Transcription Agent post-processing. Whisper on noisy phone audio produces:
 *  - repetition loops ("ciao. ciao. ciao." / "di un'interno di un'interno …")
 *  - words inside silence (hallucinated)
 *  - timestamps past the end of the file
 * We flag instead of deleting so the UI can show what was dropped and why.
 */
export function cleanTranscript(words: Word[], silences: Range[], duration: number): Word[] {
  let ws = words
    .map((w) => ({ ...w, flags: [...(w.flags ?? [])], text: w.text.trim() }))
    .filter((w) => w.text.length > 0)
    .map((w) => ({ ...w, start: Math.max(0, Math.min(w.start, duration)), end: Math.max(0, Math.min(Math.max(w.end, w.start), duration)) }))
    .sort((a, b) => a.start - b.start);

  // Very long single words are alignment garbage at chunk ends: cap to 1.2 s.
  ws = ws.map((w) => (w.end - w.start > 1.2 ? { ...w, end: w.start + 1.2 } : w));

  // 0) Chunk-overlap duplicates: long-form ASR stitches 30 s windows and may emit the same word twice with
  //    overlapping timestamps ("fatto fatto", "ringraziamo ingratchiamo"). A word that overlaps the previous
  //    kept word by more than half of the shorter one is a duplicate.
  let lastKept: Word | null = null;
  ws = ws.map((w) => {
    if (lastKept) {
      const ov = Math.min(w.end, lastKept.end) - Math.max(w.start, lastKept.start);
      const shorter = Math.max(0.02, Math.min(w.end - w.start, lastKept.end - lastKept.start));
      if (ov > 0.5 * shorter) return addFlag(w, 'hallucination');
    }
    lastKept = w;
    return w;
  });

  // 1) Loops: an n-gram (n=1..4) repeated ≥ 3 times back-to-back → keep the first, flag the rest.
  const keys = ws.map((w) => norm(w.text));
  const flagged = new Set<number>();
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= ws.length; i++) {
      const gram = keys.slice(i, i + n).join(' ');
      if (!gram) continue;
      let reps = 1;
      let j = i + n;
      while (j + n <= ws.length && keys.slice(j, j + n).join(' ') === gram) {
        reps++;
        j += n;
      }
      if (reps >= 3) {
        for (let k = i + n; k < j; k++) flagged.add(k);
        i = j - 1;
      }
    }
  }
  ws = ws.map((w, i) => (flagged.has(i) ? addFlag(w, 'hallucination') : w));

  // 1b) Templated loops: Whisper on noise often emits the same sentence frame again and again with different
  //     fillers ("La nostra città è scoperta. La nostra domanda è scomposta. …"). Three or more consecutive short
  //     sentences opening with the same two words → the whole run is hallucinated (the first included).
  {
    const sents: { from: number; to: number; key: string }[] = [];
    let from = 0;
    ws.forEach((w, i) => {
      if (/[.!?]$/.test(w.text) || i === ws.length - 1) {
        const k = keys.slice(from, Math.min(from + 2, i + 1)).join(' ');
        sents.push({ from, to: i, key: k });
        from = i + 1;
      }
    });
    for (let a = 0; a < sents.length; a++) {
      let b = a;
      while (b + 1 < sents.length && sents[b + 1].key === sents[a].key && sents[b + 1].to - sents[b + 1].from <= 8) b++;
      if (b - a + 1 >= 3 && sents[a].key.split(' ').length === 2) {
        // The sentence just before often already contains the frame ("e la nostra domanda …").
        const prev = sents[a - 1];
        const start = prev && keys.slice(prev.from, prev.to + 1).join(' ').includes(sents[a].key) ? prev.from : sents[a].from;
        for (let k = start; k <= sents[b].to; k++) ws[k] = addFlag(ws[k], 'hallucination');
        a = b;
      }
    }
  }

  // 2) Words that sit (≥ 80 %) inside detected silence were not spoken.
  ws = ws.map((w) => {
    const len = Math.max(0.01, w.end - w.start);
    const inSil = silences.reduce((acc, s) => acc + overlap(w, s), 0);
    return inSil / len >= 0.8 ? addFlag(w, 'hallucination') : w;
  });

  // 3) Vocal fillers; stuttered duplicates ("la la") → first one is a false start.
  ws = ws.map((w, i) => {
    if (isVocalFiller(w.text)) return addFlag(w, 'filler');
    const next = ws[i + 1];
    if (next && norm(next.text) === norm(w.text) && next.start - w.end < 0.6 && !w.flags.includes('hallucination') && !next.flags.includes('hallucination') && norm(w.text).length > 0) {
      return addFlag(w, 'repeat');
    }
    return w;
  });

  // 4) Restarted phrases: the speaker abandons a short take and says it again ("la pizza di… la pizza di
  //    ottobre"). Only short abandoned takes (≤ n+2 words, < 2.5 s) qualify, so normal repetition survives.
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= ws.length; i++) {
      if (ws[i].flags.includes('hallucination')) continue;
      const gramWords = keys.slice(i, i + n);
      if (gramWords.every((k) => isStopWord(k))) continue;
      const gram = gramWords.join(' ');
      for (let j = i + n; j + n <= ws.length && j - i <= n + 2 && ws[j].start - ws[i].start < 2.5; j++) {
        if (keys.slice(j, j + n).join(' ') === gram && !ws[j].flags.includes('hallucination')) {
          for (let k = i; k < j; k++) if (!ws[k].flags.includes('hallucination')) ws[k] = addFlag(ws[k], 'false_start');
          break;
        }
      }
    }
  }
  return ws;
}

export const isDropped = (w: Word) => w.flags.includes('hallucination');
export const isRemovable = (w: Word, opts: { fillers: boolean; falseStarts: boolean }) =>
  isDropped(w) ||
  (opts.fillers && w.flags.includes('filler')) ||
  (opts.falseStarts && (w.flags.includes('repeat') || w.flags.includes('false_start')));

/** Leading discourse markers ("Allora, …") at the start of a take. */
export function isLeadingFiller(words: Word[], i: number): boolean {
  const w = words[i];
  if (!isLeadingMarker(w.text)) return false;
  const prev = words[i - 1];
  return !prev || /[.!?]$/.test(prev.text) || w.start - prev.end > 0.6;
}
