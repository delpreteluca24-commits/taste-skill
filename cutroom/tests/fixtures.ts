import type { EditContext, RawAnalysis, Word } from '../src/core/timeline';
import { analyzeVideo, assignStoryRoles } from '../src/core/agents/story';

type W = [string, number, number];

export function words(mediaId: string, list: W[]): Word[] {
  return list.map(([text, start, end], i) => ({ id: `${mediaId}_w${i}`, text, start, end, flags: [] }));
}

/** Words from a sentence string laid out at ~0.32 s/word starting at `t0`. */
export function say(text: string, t0: number, wordLen = 0.28, gap = 0.04): W[] {
  let t = t0;
  return text.split(/\s+/).map((w) => {
    const item: W = [w, +t.toFixed(3), +(t + wordLen).toFixed(3)];
    t += wordLen + gap;
    return item;
  });
}

export function raw(opts: Partial<RawAnalysis> & { duration: number; words?: Word[] }): RawAnalysis {
  const n = Math.ceil(opts.duration * 2);
  return {
    duration: opts.duration,
    fps: 30,
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
    hasAudio: true,
    loudness: opts.loudness ?? { integrated: -18, truePeak: -2, lra: 6 },
    silences: opts.silences ?? [],
    scenes: opts.scenes ?? [],
    black: opts.black ?? [],
    freeze: opts.freeze ?? [],
    motion: opts.motion ?? Array.from({ length: n }, (_, i) => 0.2 + 0.3 * Math.abs(Math.sin(i / 3))),
    energy: opts.energy ?? Array.from({ length: n }, (_, i) => 0.3 + 0.2 * Math.abs(Math.sin(i / 5))),
    sampleFps: 2,
    faces: opts.faces ?? Array.from({ length: n }, (_, i) => ({ t: i / 2, boxes: [{ x: 0.4, y: 0.25, w: 0.2, h: 0.12, score: 0.9 }] })),
    transcript: opts.words ? { language: 'it', model: 'test', text: opts.words.map((w) => w.text).join(' '), words: opts.words } : null,
  };
}

/** A: talking head 30 s (intro, filler, numbers, pauses). B: b-roll 8 s. C: talking 6 s with CTA. */
export function demoContext(): EditContext {
  const aWords = words('A', [
    ...say('Ciao ragazzi oggi vi parlo della pizza.', 0.5),
    ...say('ehm', 3.2),
    ...say('Abbiamo speso 1.000 euro per il forno nuovo.', 4.6),
    ...say('Il problema è che la cottura non era perfetta.', 9.5),
    ...say('Allora abbiamo cambiato farina e temperatura.', 14.2),
    ...say('Il risultato è incredibile: pronta in 90 secondi!', 19.8),
    ...say('Ecco il segreto della nostra pizza.', 25.0),
  ]);
  const cWords = words('C', [...say('Vi aspettiamo in pizzeria, seguimi per altri video!', 0.4)]);
  const A = analyzeVideo('A', 'a.mp4', raw({ duration: 30, words: aWords, silences: [{ start: 2.6, end: 3.15 }, { start: 7.9, end: 9.4 }, { start: 12.6, end: 14.1 }, { start: 17.2, end: 19.7 }] }));
  const B = analyzeVideo('B', 'b.mp4', raw({ duration: 8, faces: [] }));
  const C = analyzeVideo('C', 'c.mp4', raw({ duration: 6, words: cWords }));
  return assignStoryRoles({ analyses: { A, B, C }, order: ['A', 'B', 'C'] });
}
