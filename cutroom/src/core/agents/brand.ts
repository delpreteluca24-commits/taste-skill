import type { EditContext, EditSettings } from '../timeline';
import { isDropped } from './transcriptClean';

export interface SloganSpan { mediaId: string; srcStart: number; srcEnd: number; wordIds: string[] }

/**
 * Channel slogan ("We uagliù, cià!"): the greeting the creator opens every video with.
 * It is the first words of the first talking clip — matched by position, not spelling, because ASR
 * mangles dialect ("Ewa Yu -Cha."). The span is protected from every cut and gets the signature animation.
 */
export function sloganSpan(ctx: EditContext, s: EditSettings): SloganSpan | null {
  if (!s.slogan) return null;
  const mediaId = ctx.order.find((id) => ctx.analyses[id]?.kind === 'aroll');
  if (!mediaId) return null;
  const words = (ctx.analyses[mediaId].raw.transcript?.words ?? []).filter((w) => !isDropped(w));
  if (!words.length) return null;
  const n = s.slogan.split(/\s+/).filter(Boolean).length;
  // First sentence if it is about slogan-sized, else the first n words.
  let k = words.findIndex((w) => /[.!?]$/.test(w.text));
  if (k < 0 || k + 1 > n + 2) k = Math.min(words.length, n) - 1;
  const span = words.slice(0, k + 1);
  return { mediaId, srcStart: Math.max(0, span[0].start - 0.15), srcEnd: span[span.length - 1].end + 0.1, wordIds: span.map((w) => w.id) };
}
