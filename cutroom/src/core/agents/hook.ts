import type { EditContext, EditSettings, Sentence } from '../timeline';
import { headline } from '../text';

export interface HookChoice {
  sentence: Sentence;
  /** Teaser copied to the start (cold open) — null when the hook is already the first line. */
  teaser: { mediaId: string; srcStart: number; srcEnd: number } | null;
  title: string;
}

function storySentences(ctx: EditContext): Sentence[] {
  return ctx.order.flatMap((id) => (ctx.analyses[id]?.kind === 'aroll' ? ctx.analyses[id].sentences : []));
}

/**
 * Hook Agent. The first 1–3 s decide retention:
 *  - title = strongest early line, shortened (≤ 6 words)
 *  - with coldOpen, a short strong line from later (often the payoff) is teased at 0 s → curiosity gap.
 * Variation (`seed`) picks the next-best candidate for "Try another version".
 */
export function chooseHook(ctx: EditContext, settings: EditSettings): HookChoice | null {
  const all = storySentences(ctx).filter((s) => s.text.split(/\s+/).length >= 2);
  if (!all.length) return null;
  const n = all.length;
  const early = all.slice(0, Math.max(1, Math.ceil(n * 0.3)));
  const first = early.find((s) => !s.wordIds.length || s.role !== 'cta') ?? all[0];
  const titleSource = [...early].sort((a, b) => b.hookScore - a.hookScore)[0] ?? first;

  let teaser: HookChoice['teaser'] = null;
  let sentence = first;
  if (settings.coldOpen && n >= 3) {
    const candidates = all
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i >= Math.floor(n * 0.25) && s.role !== 'cta' && s.end - s.start >= 1 && s.end - s.start <= 3.8)
      .map(({ s }) => ({ s, v: s.hookScore * 0.55 + s.score * 0.45 + (s.role === 'payoff' ? 0.15 : 0) }))
      .sort((a, b) => b.v - a.v);
    if (candidates.length) {
      // Variations cycle through the best three candidates (deterministic, always a different pick).
      const idx = settings.seed % Math.min(3, candidates.length);
      const pick = candidates[idx];
      // Only tease when it clearly beats the natural opening line.
      if (pick.v > first.hookScore * 0.55 + first.score * 0.45 + 0.05 || settings.seed > 0) {
        sentence = pick.s;
        teaser = { mediaId: pick.s.mediaId, srcStart: Math.max(0, pick.s.start - 0.05), srcEnd: pick.s.end + 0.12 };
      }
    }
  }
  // With a teaser the title labels what is being shown, so it comes from the teased line.
  return { sentence, teaser, title: headline((teaser ? sentence : titleSource).text, 6) };
}
