import type { ClipItem, EditContext, EditSettings, GraphicItem, Sentence } from '../timeline';
import { headline, isNumberLike, isPopupWord, isProperNounCandidate, norm, parseNumber } from '../text';
import { hashId, round } from '../util';
import { mapWords } from './subtitle';
import { mapAnchor, srcToOutput } from '../timemap';
import { sloganSpan } from './brand';
import type { HookChoice } from './hook';

const UNITS = new Set(['euro', 'dollari', 'dollars', 'giorni', 'giorno', 'anni', 'anno', 'mesi', 'mese', 'ore', 'ora', 'minuti', 'minuto', 'secondi', 'volte', 'persone', 'clienti', 'km', 'kg', 'grammi', 'litri', 'percento', '%', 'days', 'years', 'months', 'hours', 'minutes', 'times', 'people', 'k', 'mila']);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Motion Graphics Agent: graphics only where they help comprehension.
 * Density is a minimum spacing, not a quota: no graphic on top of another, none in the first 2 s if a title runs.
 */
export function buildGraphics(ctx: EditContext, clips: ClipItem[], s: EditSettings, overrides: Record<string, string>, duration: number, hook: HookChoice | null): GraphicItem[] {
  const out: GraphicItem[] = [];
  if (duration <= 0) return out;
  const busyUntil = { top: 0 } as Record<string, number>;

  const sl = sloganSpan(ctx, s);
  const slOut = sl ? mapAnchor(clips, sl) : null;
  if (s.slogan && sl && slOut) {
    const start = Math.max(0, slOut.start);
    // Hold a beat after the greeting, but never over the next spoken line (its caption must show).
    const nextWord = (ctx.analyses[sl.mediaId].raw.transcript?.words ?? []).find((w) => w.start >= sl.srcEnd - 0.05 && !w.flags.includes('hallucination'));
    const tNext = nextWord ? srcToOutput(clips, sl.mediaId, nextWord.start) : null;
    let end = slOut.end + 0.45;
    if (tNext !== null && tNext > start + 1.4) end = Math.min(end, tNext - 0.05);
    end = Math.min(duration, Math.max(end, start + 1.4));
    out.push({
      id: hashId('g', 'slogan'), type: 'graphic', start: round(start), end: round(end), layer: 9,
      reason: 'Slogan del canale: firma riconoscibile di ogni video',
      anchor: { mediaId: sl.mediaId, srcStart: sl.srcStart, srcEnd: sl.srcStart + (end - start) },
      properties: { kind: 'slogan', text: s.slogan.toUpperCase(), position: 'center' },
    });
    busyUntil.top = end + 0.3;
  } else if (s.titleCard && hook?.title && hook.title.split(' ').length >= 2) {
    const end = Math.min(2.4, duration);
    out.push({
      id: hashId('g', 'title'), type: 'graphic', start: 0.1, end: round(end), layer: 5,
      reason: 'Hook visivo nei primi secondi', locked: false,
      properties: { kind: 'title', text: hook.title, position: 'top' },
    });
    busyUntil.top = end + 0.6;
  }

  if (s.graphicsDensity > 0) {
    const words = mapWords(ctx, clips, overrides, false);
    const minGap = lerp(12, 3.5, s.graphicsDensity);
    let last = -Infinity;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const num = isNumberLike(w.raw);
      const alert = !num && isPopupWord(w.raw);
      const proper = !num && !alert && s.graphicsDensity >= 0.7 && isProperNounCandidate(w.raw, w.prevRaw);
      if (!num && !alert && !proper) continue;
      if (w.start - last < minGap) continue;
      const title = out.find((g) => g.properties.kind === 'title');
      if (w.start < busyUntil.top) {
        // A key number beats the title card once the title had ≥ 1.3 s on screen.
        if (!(num && title && w.start - title.start >= 1.3)) continue;
        title.end = round(w.start - 0.1);
      }
      const clip = clips.find((c) => c.id === w.clipId);
      if (!clip || w.start > duration - 1.2) continue;
      let text = w.text.replace(/[.,!?;:]+$/, '');
      const next = words[i + 1];
      if (num && next && UNITS.has(norm(next.text)) && next.start - w.end < 0.5) text = `${text} ${next.text.replace(/[.,!?;:]+$/, '')}`;
      const value = num ? parseNumber(w.raw.replace(/[.,!?;:]+$/, '')) : null;
      const money = /€|euro/i.test(text);
      const kind = value !== null && value >= 10 ? 'counter' : 'keyword';
      const end = Math.min(clip.end, w.start + 1.6);
      if (end - w.start < 0.6) continue;
      out.push({
        id: hashId('g', w.id), type: 'graphic', start: round(w.start), end: round(end), layer: 5,
        reason: num ? `Numero chiave: "${text}"` : alert ? `Parola forte: "${text}"` : `Nome/elemento citato: "${text}"`,
        anchor: { mediaId: w.source, srcStart: w.srcStart, srcEnd: w.srcStart + (end - w.start) * clip.properties.speed },
        properties: kind === 'counter'
          ? { kind, text: text.toUpperCase(), value: value!, prefix: money ? '€' : undefined, suffix: money ? undefined : text.replace(/^[\d.,]+\s*/, '').toUpperCase() || undefined, position: 'top' }
          : { kind, text: text.toUpperCase(), position: 'top' },
      });
      last = w.start;
      busyUntil.top = end + 0.4;
    }
  }

  // Full-screen pattern interruption on the payoff (aggressive / educational presets only).
  if (s.graphicsDensity >= 0.7) {
    const payoff = ctx.order.flatMap((id) => ctx.analyses[id]?.sentences ?? []).find((x: Sentence) => x.role === 'payoff');
    if (payoff) {
      const t = srcToOutput(clips, payoff.mediaId, payoff.start);
      if (t !== null && t > 3 && t < duration - 3 && !out.some((g) => Math.abs(g.start - t) < 1.5)) {
        out.push({
          id: hashId('g', 'fs', payoff.id), type: 'graphic', start: round(t), end: round(t + 0.9), layer: 7,
          reason: 'Pattern interruption: payoff', anchor: { mediaId: payoff.mediaId, srcStart: payoff.start, srcEnd: payoff.start + 0.9 },
          properties: { kind: 'fullscreen', text: headline(payoff.text, 4), position: 'center' },
        });
      }
    }
  }

  // CTA: explicit text, or the speaker's own CTA line.
  const ctaSentence = ctx.order.flatMap((id) => ctx.analyses[id]?.sentences ?? []).filter((x) => x.role === 'cta').pop();
  const ctaText = s.ctaText ?? (ctaSentence && s.graphicsDensity >= 0.3 ? headline(ctaSentence.text, 5) : null);
  if (ctaText && duration > 4) {
    const start = Math.max(duration - 2.6, duration * 0.6);
    const kept = out.filter((g) => g.end <= start - 0.2 || g.properties.position !== 'top');
    out.length = 0;
    out.push(...kept, {
      id: hashId('g', 'cta'), type: 'graphic', start: round(start), end: round(duration), layer: 6,
      reason: s.ctaText ? 'CTA finale richiesta' : 'CTA del parlato messa in evidenza',
      properties: { kind: 'cta', text: ctaText.toUpperCase(), position: 'top' },
    });
  }

  if (s.progressBar) {
    out.push({
      id: hashId('g', 'progress'), type: 'graphic', start: 0, end: round(duration), layer: 8,
      reason: 'Barra di avanzamento: aumenta il completamento',
      properties: { kind: 'progress', text: '', position: 'top' },
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
