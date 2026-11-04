import type { EditContext, RawAnalysis, Sentence, SentenceRole, VideoAnalysis, Word } from '../timeline';
import {
  isAlertWord, isCtaText, isCuriosityText, isHookText, isIntroText, isNumberLike, isPayoffText, isProblemText,
  isProperNounCandidate, norm,
} from '../text';
import { clamp, hashId, mergeSpans, round, totalLen } from '../util';
import { cleanTranscript, isDropped } from './transcriptClean';

/** Sentence segmentation on punctuation and pauses (Whisper punctuation is decent; pauses catch the rest). */
export function segmentSentences(mediaId: string, words: Word[]): Omit<Sentence, 'role' | 'score' | 'hookScore'>[] {
  const live = words.filter((w) => !isDropped(w));
  const out: Omit<Sentence, 'role' | 'score' | 'hookScore'>[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      id: hashId('s', mediaId, cur[0].start),
      mediaId,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
      wordIds: cur.map((w) => w.id),
    });
    cur = [];
  };
  for (let i = 0; i < live.length; i++) {
    const w = live[i];
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.75 || w.end - cur[0].start > 12)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

export function classifyRole(text: string, index: number, count: number): SentenceRole {
  const pos = count <= 1 ? 0 : index / (count - 1);
  if (isCtaText(text) && pos >= 0.5) return 'cta';
  if (index === 0 && !isIntroText(text)) return 'hook';
  if (isHookText(text) && pos < 0.3) return 'hook';
  if (isPayoffText(text) && pos >= 0.4) return 'payoff';
  if (isCuriosityText(text)) return 'curiosity';
  if (isProblemText(text)) return 'problem';
  if (pos < 0.35) return 'context';
  return 'body';
}

/** 0..1: how well a sentence works as a first line. Observable cues only. */
export function hookScoreOf(text: string, durationS: number): number {
  let s = 0.3;
  if (isHookText(text)) s += 0.25;
  if (/\?\s*$/.test(text)) s += 0.1;
  const words = text.split(/\s+/);
  if (words.some(isNumberLike)) s += 0.15;
  if (words.some(isAlertWord)) s += 0.1;
  if (isIntroText(text)) s -= 0.4;
  if (durationS > 6) s -= 0.15;
  if (durationS < 1) s -= 0.15;
  return clamp(round(s, 2), 0, 1);
}

function importance(text: string, role: SentenceRole): number {
  let s = 0.4;
  const words = text.split(/\s+/);
  if (words.some(isNumberLike)) s += 0.2;
  if (words.some(isAlertWord)) s += 0.1;
  if (role === 'hook' || role === 'payoff' || role === 'cta') s += 0.3;
  if (role === 'problem' || role === 'curiosity') s += 0.15;
  if (words.length <= 2) s -= 0.2;
  return clamp(round(s, 2), 0, 1);
}

function peaks(series: number[], fps: number, k = 1.2): number[] {
  if (series.length < 3) return [];
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
  const out: number[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    if (series[i] > mean + k * sd && series[i] >= series[i - 1] && series[i] >= series[i + 1]) {
      const t = i / fps;
      if (!out.length || t - out[out.length - 1] > 1.5) out.push(round(t, 2));
    }
  }
  return out;
}

export function emphasisWords(words: Word[]): Word[] {
  return words.filter((w, i) => !isDropped(w) && (isNumberLike(w.text) || isAlertWord(w.text) || isProperNounCandidate(w.text, words[i - 1]?.text)));
}

/** Story Agent + per-file VIDEO_ANALYSIS. */
export function analyzeVideo(mediaId: string, filename: string, raw: RawAnalysis): VideoAnalysis {
  const words = raw.transcript ? cleanTranscript(raw.transcript.words, raw.silences, raw.duration) : [];
  const live = words.filter((w) => !isDropped(w));
  const speechSpans = mergeSpans(live.map((w) => ({ start: w.start, end: w.end })), 0.3);
  const speechRatio = raw.duration > 0 ? clamp(totalLen(speechSpans) / raw.duration, 0, 1) : 0;
  const kind: VideoAnalysis['kind'] = speechRatio >= 0.18 && live.length >= 4 ? 'aroll' : 'broll';

  const base = segmentSentences(mediaId, words);
  const sentences: Sentence[] = base.map((s, i) => {
    const role = classifyRole(s.text, i, base.length);
    return { ...s, role, score: importance(s.text, role), hookScore: hookScoreOf(s.text, s.end - s.start) };
  });
  // Mark the greeting/intro sentence for the Hook agent.
  const introIds = new Set(sentences.filter((s, i) => i === 0 && isIntroText(s.text)).flatMap((s) => s.wordIds));
  const flaggedWords = words.map((w) => (introIds.has(w.id) && !w.flags.includes('intro') ? { ...w, flags: [...w.flags, 'intro' as const] } : w));

  const transcript = raw.transcript ? { ...raw.transcript, words: flaggedWords } : null;
  const emph = emphasisWords(flaggedWords);
  const orientation = raw.width > raw.height * 1.05 ? 'landscape' : raw.height > raw.width * 1.05 ? 'portrait' : 'square';
  const silenceTotal = raw.silences.reduce((a, s) => a + (s.end - s.start), 0);
  const fillerWordIds = flaggedWords.filter((w) => w.flags.includes('filler')).map((w) => w.id);
  const dropped = words.filter(isDropped).length;

  const hookScore = sentences.length ? Math.max(...sentences.slice(0, 3).map((s) => s.hookScore)) : 0;
  const changeRate = raw.duration > 0 ? raw.scenes.length / raw.duration : 0;
  const retentionScore = clamp(round(0.35 + 0.4 * (1 - silenceTotal / Math.max(1, raw.duration)) + Math.min(0.25, changeRate * 2), 2), 0, 1);
  const wps = speechSpans.length ? live.length / Math.max(1, totalLen(speechSpans)) : 0;
  const clarityScore = kind === 'broll'
    ? 0.5
    : clamp(round(0.9 - Math.abs(wps - 2.6) * 0.15 - (fillerWordIds.length / Math.max(1, live.length)) * 2 - (dropped / Math.max(1, words.length)) * 0.6, 2), 0, 1);

  return {
    mediaId,
    filename,
    raw: { ...raw, transcript },
    orientation,
    kind,
    speechRatio: round(speechRatio, 3),
    sentences,
    fillerWordIds,
    importantSentenceIds: sentences.filter((s) => s.score >= 0.7).map((s) => s.id),
    emotionalPeaks: peaks(raw.energy, raw.sampleFps),
    visualChanges: raw.scenes,
    recommendedCuts: [
      ...raw.silences.filter((s) => s.end - s.start > 0.4).map((s) => ({ start: s.start, end: s.end, reason: 'silenzio' })),
      ...flaggedWords.filter((w) => w.flags.some((f) => f !== 'emphasis')).map((w) => ({ start: w.start, end: w.end, reason: w.flags.join(',') })),
    ],
    recommendedZoomPoints: emph.map((w) => ({ t: w.start, reason: `enfasi su "${w.text}"` })),
    recommendedGraphics: emph.filter((w) => isNumberLike(w.text) || isAlertWord(w.text)).map((w) => ({ t: w.start, text: w.text, reason: 'parola chiave' })),
    recommendedSfx: raw.scenes.map((t) => ({ t, name: 'whoosh', reason: 'cambio scena' })),
    hookScore,
    retentionScore,
    clarityScore,
  };
}

export const wordById = (a: VideoAnalysis) => new Map((a.raw.transcript?.words ?? []).map((w) => [w.id, w]));
export const liveWords = (a: VideoAnalysis) => (a.raw.transcript?.words ?? []).filter((w) => !isDropped(w));
export const normText = norm;

/**
 * Story Agent, project level: roles depend on the position in the WHOLE story (all clips in narrative
 * order), not inside one file — a short last clip saying "seguimi" is the CTA even if it is its file's only line.
 */
export function assignStoryRoles(ctx: EditContext): EditContext {
  const all = ctx.order.flatMap((id) => (ctx.analyses[id]?.kind === 'aroll' ? ctx.analyses[id].sentences : []));
  const roles = new Map(all.map((s, i) => {
    const role = classifyRole(s.text, i, all.length);
    return [s.id, { role, score: importance(s.text, role) }];
  }));
  const analyses: EditContext['analyses'] = {};
  for (const [id, a] of Object.entries(ctx.analyses)) {
    const sentences = a.sentences.map((s) => (roles.has(s.id) ? { ...s, ...roles.get(s.id)! } : s));
    analyses[id] = { ...a, sentences, importantSentenceIds: sentences.filter((s) => s.score >= 0.7).map((s) => s.id) };
  }
  return { ...ctx, analyses };
}
