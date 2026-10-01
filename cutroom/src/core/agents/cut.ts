import type { ClipItem, CutItem, CutKind, EditContext, EditSettings, Timeline, VideoAnalysis, Word } from '../timeline';
import { isAlertWord, isNumberLike } from '../text';
import { hashId, mergeSpans, overlap, round, subtractSpans, totalLen, type Span } from '../util';
import { chooseHook, type HookChoice } from './hook';
import { focusForSpan, stabilize } from './reframe';
import { isLeadingFiller, isRemovable } from './transcriptClean';
import { layoutClips } from '../timemap';

interface Keep extends Span {
  mediaId: string;
  role: 'aroll' | 'broll' | 'hook';
  /** Story weight of the span (for duration trimming). */
  score: number;
  sentenceRole?: string;
}

export function meanMotion(a: VideoAnalysis, from: number, to: number): number {
  const fps = a.raw.sampleFps || 2;
  const i0 = Math.max(0, Math.floor(from * fps));
  const i1 = Math.min(a.raw.motion.length - 1, Math.ceil(to * fps));
  if (i1 < i0) return 0;
  let s = 0;
  for (let i = i0; i <= i1; i++) s += a.raw.motion[i];
  return s / (i1 - i0 + 1);
}

/** Keep spans of a talking clip: words + padding, pauses longer than maxPause removed. */
export function speechKeeps(a: VideoAnalysis, s: EditSettings, isFirstSpeech: boolean): { keeps: Span[]; removed: { span: Span; kind: CutKind }[] } {
  const words = a.raw.transcript?.words ?? [];
  const removed: { span: Span; kind: CutKind }[] = [];
  const kept: Word[] = [];
  let leading = isFirstSpeech;
  words.forEach((w, i) => {
    const drop = isRemovable(w, { fillers: s.removeFillers, falseStarts: s.removeFalseStarts });
    const introDrop = w.flags.includes('intro') && s.removeIntro;
    const leadDrop = leading && s.removeIntro && isLeadingFiller(words, i);
    if (drop || introDrop || leadDrop) {
      const kind: CutKind = w.flags.includes('hallucination') ? 'hallucination'
        : w.flags.includes('intro') || leadDrop ? 'intro'
        : w.flags.includes('filler') ? 'filler'
        : w.flags.includes('false_start') ? 'false_start' : 'repeat';
      removed.push({ span: { start: w.start, end: w.end }, kind });
      return;
    }
    leading = false;
    kept.push(w);
  });
  const spans: Span[] = [];
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    const next = kept[i + 1];
    const emphasisNext = next && (isNumberLike(next.text) || isAlertWord(next.text));
    let allowed = s.maxPause + (emphasisNext ? s.emphasisPause : 0) + (/[.!?]$/.test(w.text) ? s.emphasisPause * 0.5 : 0);
    // Action pauses: silence over visible work (hands, product) is content, not dead air.
    if ((s.actionPause ?? 0) > allowed && next && meanMotion(a, w.end, next.start) >= 0.3) allowed = s.actionPause;
    const cur = spans[spans.length - 1];
    const span = { start: Math.max(0, w.start - s.padBefore), end: Math.min(a.raw.duration, w.end + s.padAfter) };
    const prevWord = kept[i - 1];
    if (cur && prevWord && w.start - prevWord.end <= allowed) cur.end = Math.max(cur.end, span.end);
    else spans.push(span);
  }
  // Never keep picture that is black.
  return { keeps: subtractSpans(spans, a.raw.black), removed };
}

/** B-roll: pick the most active window in each of N regions → keeps the shot order (narrative) intact. */
export function brollKeeps(a: VideoAnalysis, s: EditSettings): Span[] {
  const d = a.raw.duration;
  const usable = subtractSpans([{ start: 0, end: d }], [...a.raw.black, ...a.raw.freeze]);
  if (!usable.length) return [];
  if (d <= s.brollShot * 1.4) return usable;
  const shots = Math.max(1, Math.min(Math.round(s.brollMaxTotal / s.brollShot), Math.floor(d / (s.brollShot * 1.5))));
  const fps = a.raw.sampleFps || 2;
  const motionAt = (t: number) => a.raw.motion[Math.min(a.raw.motion.length - 1, Math.max(0, Math.round(t * fps)))] ?? 0;
  const out: Span[] = [];
  for (let k = 0; k < shots; k++) {
    const r0 = (d / shots) * k;
    const r1 = (d / shots) * (k + 1);
    let best = { t: r0, v: -1 };
    for (let t = r0; t + s.brollShot <= r1 + 1e-6; t += 0.25) {
      const span = { start: t, end: t + s.brollShot };
      if (totalLen(subtractSpans([span], usable)) > 0.01) continue;
      let v = 0;
      for (let u = t; u < t + s.brollShot; u += 0.25) v += motionAt(u);
      // Prefer windows that start right after a scene change (a natural edit point).
      if (a.raw.scenes.some((sc) => sc >= t - 0.3 && sc <= t + 0.2)) v *= 1.15;
      if (v > best.v) best = { t, v };
    }
    if (best.v >= 0) out.push({ start: round(best.t), end: round(best.t + s.brollShot) });
  }
  return out;
}

const sentenceAt = (a: VideoAnalysis, sp: Span) => {
  let best: { score: number; role: string; ov: number } | null = null;
  for (const se of a.sentences) {
    const ov = overlap(sp, se);
    if (ov > 0 && (!best || ov > best.ov)) best = { score: se.score, role: se.role, ov };
  }
  return best;
};

/** Cut Agent: all clips for the timeline + the record of every removed range and why. */
export function buildClips(ctx: EditContext, s: EditSettings, userCuts: Timeline['userCuts']) {
  const cuts: CutItem[] = [];
  const warnings: string[] = [];
  const keeps: Keep[] = [];
  let firstSpeech = true;
  const hook: HookChoice | null = chooseHook(ctx, s);

  for (const mediaId of ctx.order) {
    const a = ctx.analyses[mediaId];
    if (!a) continue;
    const d = a.raw.duration;
    let spans: Span[];
    let removed: { span: Span; kind: CutKind }[] = [];
    if (a.kind === 'aroll') {
      const r = speechKeeps(a, s, firstSpeech);
      spans = r.keeps;
      removed = r.removed;
      firstSpeech = false;
    } else {
      spans = brollKeeps(a, s);
    }
    const user = userCuts.filter((u) => u.source === mediaId);
    spans = subtractSpans(spans, user).filter((sp) => sp.end - sp.start >= 0.25);
    // Merge fragments shorter than minShot into a neighbour if they are close, else keep only if ≥ 0.3 s.
    spans = mergeSpans(spans, 0).reduce<Span[]>((acc, sp) => {
      const last = acc[acc.length - 1];
      if (last && sp.end - sp.start < s.minShot && sp.start - last.end < 0.35) last.end = sp.end;
      else acc.push({ ...sp });
      return acc;
    }, []);
    for (const sp of spans) {
      const st = sentenceAt(a, sp);
      keeps.push({ ...sp, mediaId, role: a.kind, score: st?.score ?? (a.kind === 'broll' ? 0.45 : 0.4), sentenceRole: st?.role });
    }
    // Record removed ranges with the most specific reason.
    const gaps = subtractSpans([{ start: 0, end: d }], spans).filter((g) => g.end - g.start > 0.05);
    for (const g of gaps) {
      const isUser = user.some((u) => overlap(u, g) > 0.05);
      const base: CutKind = isUser ? 'user' : a.kind === 'broll' ? 'broll_trim' : a.raw.black.some((b) => overlap(b, g) > 0.1) ? 'black' : 'silence';
      // Split the gap by reason: removed words keep their own kind, the rest is pause/black/user.
      const segs: { start: number; end: number; kind: CutKind }[] = [];
      for (const r of removed.filter((x) => overlap(x.span, g) > 0).sort((x, y) => x.span.start - y.span.start)) {
        const st = Math.max(g.start, r.span.start);
        const en = Math.min(g.end, r.span.end);
        const last = segs[segs.length - 1];
        if (last && last.kind === r.kind && st - last.end < 0.5) last.end = en;
        else segs.push({ start: st, end: en, kind: isUser ? 'user' : r.kind });
      }
      let cursor = g.start;
      const all: typeof segs = [];
      for (const sg of segs) {
        if (sg.start - cursor > 0.05) all.push({ start: cursor, end: sg.start, kind: base });
        all.push(sg);
        cursor = sg.end;
      }
      if (g.end - cursor > 0.05) all.push({ start: cursor, end: g.end, kind: base });
      for (const sg of all) {
        cuts.push({ id: hashId('cut', mediaId, sg.start), type: 'cut', source: mediaId, start: round(sg.start), end: round(sg.end), kind: sg.kind, reason: CUT_REASON[sg.kind] });
      }
    }
  }

  // Duration budget (Story Agent): drop the weakest story spans, never hook/payoff/CTA, never the last span of a file.
  const teaserLen = hook?.teaser ? hook.teaser.srcEnd - hook.teaser.srcStart : 0;
  if (s.maxDuration) {
    const total = () => totalLen(keeps) + teaserLen;
    const protectedRoles = new Set(['hook', 'payoff', 'cta']);
    const candidates = keeps
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => !protectedRoles.has(k.sentenceRole ?? ''))
      .sort((x, y) => x.k.score - y.k.score || (y.k.end - y.k.start) - (x.k.end - x.k.start));
    const removedIdx = new Set<number>();
    let running = total();
    for (const { k, i } of candidates) {
      if (running <= s.maxDuration) break;
      const sameMedia = keeps.filter((x, j) => x.mediaId === k.mediaId && !removedIdx.has(j));
      if (sameMedia.length <= 1) continue;
      removedIdx.add(i);
      running -= k.end - k.start;
      cuts.push({ id: hashId('cut', k.mediaId, k.start, 'dur'), type: 'cut', source: k.mediaId, start: round(k.start), end: round(k.end), kind: 'duration', reason: CUT_REASON.duration });
    }
    const kept = keeps.filter((_, i) => !removedIdx.has(i));
    keeps.length = 0;
    keeps.push(...kept);
    if (total() > s.maxDuration + 1) warnings.push(`Durata ${Math.round(total())}s oltre il massimo di ${s.maxDuration}s: i passaggi rimasti sono tutti essenziali.`);
  }

  if (hook?.teaser) keeps.unshift({ start: hook.teaser.srcStart, end: hook.teaser.srcEnd, mediaId: hook.teaser.mediaId, role: 'hook', score: 1 });

  // Reframing per clip, stabilized across jump cuts of the same take.
  let prevCrop: ClipItem['properties']['crop'] | null = null;
  let prevMedia = '';
  const clips: ClipItem[] = keeps.map((k) => {
    const a = ctx.analyses[k.mediaId];
    const focus = focusForSpan(a.raw, k.start, k.end);
    const crop = k.mediaId === prevMedia ? stabilize(prevCrop, focus) : focus;
    prevCrop = crop;
    prevMedia = k.mediaId;
    return {
      id: hashId('clip', k.mediaId, k.start, k.role),
      type: 'clip' as const,
      source: k.mediaId,
      start: 0,
      end: 0,
      layer: 0,
      reason: k.role === 'hook' ? 'Cold open: anticipa il momento più forte' : k.role === 'broll' ? 'B-roll: finestra visiva più dinamica' : 'Parlato utile (pause e ripetizioni rimosse)',
      properties: {
        srcStart: round(k.start),
        srcEnd: round(k.end),
        speed: 1,
        volume: k.role === 'broll' ? 0.6 : 1,
        role: k.role,
        crop,
      },
    };
  });
  return { clips: layoutClips(clips), cuts, hook, warnings };
}

export const CUT_REASON: Record<CutKind, string> = {
  silence: 'Pausa / momento morto',
  filler: 'Esitazione (ehm, uhm…)',
  repeat: 'Parola ripetuta',
  false_start: 'Falsa partenza: tenuta la ripresa migliore',
  intro: 'Intro non necessaria',
  hallucination: 'Rumore trascritto per errore',
  broll_trim: 'B-roll accorciato alla parte più dinamica',
  duration: 'Rimosso per rispettare la durata massima',
  black: 'Frame neri',
  user: 'Tagliato su tua richiesta',
};
