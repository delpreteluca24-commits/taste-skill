import type { ClipItem, EditContext, EditSettings, EffectItem, TransitionItem, ZoomItem } from '../timeline';
import { isAlertWord, isNumberLike } from '../text';
import { hashId, rng, round } from '../util';
import { mapWords } from './subtitle';
import { sloganSpan } from './brand';
import { mapAnchor } from '../timemap';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Emphasis moments in output time: numbers, money, alert words, and the first word of payoff/hook lines. */
export function emphasisMoments(ctx: EditContext, clips: ClipItem[], overrides: Record<string, string>) {
  const words = mapWords(ctx, clips, overrides, false);
  const sentenceStarts = new Map<string, string>();
  for (const id of ctx.order) {
    for (const s of ctx.analyses[id]?.sentences ?? []) if (['payoff', 'hook', 'problem'].includes(s.role)) sentenceStarts.set(s.wordIds[0], s.role);
  }
  return words
    .filter((w) => isNumberLike(w.raw) || isAlertWord(w.raw) || sentenceStarts.has(w.id))
    .map((w) => ({
      t: w.start,
      end: w.end,
      word: w,
      strength: isNumberLike(w.raw) ? 1 : isAlertWord(w.raw) ? 0.8 : 0.6,
      why: isNumberLike(w.raw) ? `numero "${w.text}"` : isAlertWord(w.raw) ? `parola forte "${w.text}"` : `inizio ${sentenceStarts.get(w.id)}`,
    }));
}

/**
 * Camera Agent. Never random:
 *  - jump cuts inside the same take alternate 100% ↔ jumpcutZoom (hides the cut, like a 2-camera shoot)
 *  - emphasis punch-ins (emphasisZoom) on numbers / strong words / payoff, spaced by density
 *  - slow push-in on long static shots and B-roll
 */
export function buildZooms(ctx: EditContext, clips: ClipItem[], s: EditSettings, overrides: Record<string, string>): ZoomItem[] {
  if (s.zoomDensity <= 0) return [];
  const out: ZoomItem[] = [];
  let alt = false;
  clips.forEach((c, i) => {
    const prev = clips[i - 1];
    const sameTake = prev && prev.source === c.source && c.properties.srcStart - prev.properties.srcEnd < 3 && prev.properties.role !== 'hook';
    alt = sameTake ? !alt : false;
    const len = c.end - c.start;
    if (alt && s.zoomDensity >= 0.15 && len < 6) {
      out.push({
        id: hashId('zj', c.id), type: 'zoom', start: c.start, end: c.end, layer: 1,
        reason: 'Jump cut: cambio inquadratura per nascondere il taglio',
        anchor: { mediaId: c.source, srcStart: c.properties.srcStart, srcEnd: c.properties.srcEnd },
        properties: { kind: 'jumpcut', from: s.jumpcutZoom, to: s.jumpcutZoom, ease: 0 },
      });
    } else if ((s.pushIn && len >= 3.5) || (c.properties.role === 'broll' && len >= 1)) {
      out.push({
        id: hashId('zp', c.id), type: 'zoom', start: c.start, end: c.end, layer: 1,
        reason: c.properties.role === 'broll' ? 'B-roll: lento movimento di camera' : 'Inquadratura lunga: push-in lento per non restare statici',
        anchor: { mediaId: c.source, srcStart: c.properties.srcStart, srcEnd: c.properties.srcEnd },
        properties: { kind: 'pushin', from: 1, to: round(1 + 0.04 + 0.03 * s.zoomDensity, 3), ease: round(len, 3) },
      });
    }
  });

  const sl = sloganSpan(ctx, s);
  const slOut = sl ? mapAnchor(clips, sl) : null;
  if (sl && slOut) {
    out.push({
      id: hashId('zs', sl.mediaId), type: 'zoom', start: slOut.start, end: round(slOut.end + 0.3), layer: 3,
      reason: 'Slogan: punch-in di camera sulla firma del canale', anchor: { ...sl, srcEnd: sl.srcEnd + 0.3 },
      properties: { kind: 'emphasis', from: 1, to: 1.18, ease: 0.1 },
    });
  }
  const minGap = lerp(9, 2.5, s.zoomDensity);
  const r = rng(s.seed + 11);
  let last = -Infinity;
  for (const m of emphasisMoments(ctx, clips, overrides)) {
    if (m.t - last < minGap) continue;
    if (m.strength < 0.7 && r() > s.zoomDensity) continue;
    const clip = clips.find((c) => m.t >= c.start && m.t < c.end);
    if (!clip || clip.properties.role === 'broll') continue;
    const end = Math.min(clip.end, m.end + 1.2);
    if (end - m.t < 0.5) continue;
    const scale = round(m.strength >= 1 ? s.emphasisZoom : lerp(s.jumpcutZoom, s.emphasisZoom, 0.6), 3);
    out.push({
      id: hashId('ze', m.word.id), type: 'zoom', start: round(m.t - 0.05), end: round(end), layer: 2,
      reason: `Enfasi: ${m.why}`,
      anchor: { mediaId: m.word.source, srcStart: m.word.srcStart - 0.05, srcEnd: m.word.srcStart - 0.05 + (end - m.t + 0.05) * clip.properties.speed },
      properties: { kind: 'emphasis', from: 1, to: scale, ease: 0.12 },
    });
    last = m.t;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Transition Engine: default CUT; transitions only where the scene really changes. */
export function buildTransitions(clips: ClipItem[], s: EditSettings): TransitionItem[] {
  if (s.transitionStyle === 'cut') return [];
  const out: TransitionItem[] = [];
  const kinds = s.transitionStyle === 'dynamic' ? (['whip', 'zoom', 'flash', 'swipe'] as const) : (['zoom', 'blur'] as const);
  const minGap = s.transitionStyle === 'dynamic' ? 3 : 6;
  let last = -Infinity;
  let k = s.seed;
  clips.forEach((c, i) => {
    if (i === 0) return;
    const prev = clips[i - 1];
    const sceneChange = prev.source !== c.source || prev.properties.role === 'hook';
    if (!sceneChange || c.start - last < minGap) return;
    const kind = kinds[k++ % kinds.length];
    out.push({
      id: hashId('tr', c.id), type: 'transition', start: round(Math.max(0, c.start - 0.14)), end: round(c.start + 0.16), layer: 4,
      reason: prev.properties.role === 'hook' ? 'Dal teaser alla storia' : 'Cambio scena / clip',
      properties: { kind, at: c.start },
    });
    last = c.start;
  });
  return out;
}

/** Pattern interruption flashes on payoff lines for the aggressive presets. */
export function buildEffects(ctx: EditContext, clips: ClipItem[], s: EditSettings, overrides: Record<string, string>): EffectItem[] {
  if (s.transitionStyle !== 'dynamic') return [];
  const moments = emphasisMoments(ctx, clips, overrides).filter((m) => m.why.startsWith('inizio payoff'));
  return moments.slice(0, 2).map((m) => ({
    id: hashId('fx', m.word.id), type: 'effect' as const, start: round(m.t), end: round(m.t + 0.18), layer: 6,
    reason: 'Pattern interruption sul payoff',
    anchor: { mediaId: m.word.source, srcStart: m.word.srcStart, srcEnd: m.word.srcStart + 0.18 },
    properties: { kind: 'flash' as const, intensity: 0.35 },
  }));
}
