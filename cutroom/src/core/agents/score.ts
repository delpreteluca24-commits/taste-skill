import type { EditContext, Timeline } from '../timeline';
import { clamp, round } from '../util';
import { mapWords } from './subtitle';
import { srcToOutput } from '../timemap';

export interface ScoreSignal { key: string; label: string; score: number; detail: string }
export interface RetentionReport { score: number; signals: ScoreSignal[]; suggestions: { at?: number; text: string }[] }

const sec = (t: number) => `${Math.floor(t)}`;

/**
 * CONTENT RETENTION SCORE — observable signals only. It is not a prediction of views.
 */
export function retentionReport(t: Timeline, ctx: EditContext): RetentionReport {
  const signals: ScoreSignal[] = [];
  const sug: RetentionReport['suggestions'] = [];
  const d = Math.max(0.1, t.duration);
  const words = mapWords(ctx, t.clips, t.wordOverrides, false);

  // 1 hook clarity: speech starts fast, hook line or title in the first 3 s
  const firstWord = words[0]?.start ?? d;
  const hasTitle = t.graphics.some((g) => g.properties.kind === 'title' && g.start < 1);
  const hookStrong = t.clips[0]?.properties.role === 'hook';
  let hook = 100 - clamp((firstWord - 0.3) * 40, 0, 60) + (hasTitle ? 10 : 0) + (hookStrong ? 10 : 0) - 20;
  hook = clamp(hook, 0, 100);
  if (firstWord > 1) sug.push({ at: 0, text: `Il parlato inizia a ${firstWord.toFixed(1)}s: anticipa l'hook ("rendi l'hook più forte").` });
  signals.push({ key: 'hook', label: 'Chiarezza hook', score: round(hook, 0), detail: hookStrong ? 'Cold open sul momento più forte' : hasTitle ? 'Titolo hook nei primi secondi' : 'Nessun hook visivo' });

  // 2 pacing: average shot length 1.5–4 s
  const asl = d / Math.max(1, t.clips.length);
  const pacing = clamp(100 - Math.max(0, asl - 4) * 18 - Math.max(0, 1.2 - asl) * 60, 0, 100);
  signals.push({ key: 'pacing', label: 'Ritmo', score: round(pacing, 0), detail: `Inquadratura media ${asl.toFixed(1)}s` });

  // 3 silence ratio: gaps between consecutive words inside a clip
  let silence = 0;
  for (let i = 1; i < words.length; i++) {
    const g = words[i].start - words[i - 1].end;
    if (words[i].clipId === words[i - 1].clipId && g > 0.35) {
      silence += g;
      if (g > 0.9) sug.push({ at: words[i - 1].end, text: `Secondi ${sec(words[i - 1].end)}-${sec(words[i].start + 0.5)}: pausa lunga.` });
    }
  }
  const brollTime = t.clips.filter((c) => c.properties.role === 'broll').reduce((a, c) => a + c.end - c.start, 0);
  const speechTime = Math.max(0.1, d - brollTime);
  const silenceScore = clamp(100 - (silence / speechTime) * 400, 0, 100);
  signals.push({ key: 'silence', label: 'Silenzi', score: round(silenceScore, 0), detail: `${silence.toFixed(1)}s di pause residue` });

  // 4 visual variation: events per 4 s window
  const events = [
    ...t.clips.map((c) => c.start),
    ...t.zoom.map((z) => z.start),
    ...t.graphics.filter((g) => g.properties.kind !== 'progress').map((g) => g.start),
    ...t.transitions.map((x) => x.start),
  ].sort((a, b) => a - b);
  let flatWindows = 0;
  const win = 4;
  const nWin = Math.max(1, Math.floor(d / win));
  for (let w = 0; w < nWin; w++) {
    const a = w * win; const b = a + win;
    const n = events.filter((e) => e > a + 0.05 && e <= b).length;
    const pushing = t.zoom.some((z) => z.properties.kind === 'pushin' && z.start <= a && z.end >= b);
    if (n === 0 && !pushing) {
      flatWindows++;
      if (flatWindows <= 4) sug.push({ at: a, text: `Secondi ${sec(a)}-${sec(b)}: ritmo visivo basso.` });
    }
  }
  const variation = clamp(100 - (flatWindows / nWin) * 120, 0, 100);
  signals.push({ key: 'variation', label: 'Varietà visiva', score: round(variation, 0), detail: `${flatWindows}/${nWin} finestre da 4s senza cambi` });

  // 5 subtitle readability: chars per second and words per group
  const cps = t.subtitles.map((s) => s.properties.words.reduce((a, w) => a + w.text.length, 0) / Math.max(0.2, s.end - s.start));
  const fast = cps.filter((c) => c > 22).length;
  const readability = t.settings.captions.enabled ? clamp(100 - (fast / Math.max(1, cps.length)) * 150 - Math.max(0, t.settings.captions.maxWords - 5) * 10, 0, 100) : 30;
  if (!t.settings.captions.enabled) sug.push({ text: 'Sottotitoli disattivati: la maggior parte degli utenti guarda senza audio.' });
  signals.push({ key: 'readability', label: 'Leggibilità sottotitoli', score: round(readability, 0), detail: `${fast} gruppi troppo veloci` });

  // 6 information density: words per minute 130–200 on speech time
  const wpm = (words.length / speechTime) * 60;
  const density = clamp(100 - Math.max(0, 130 - wpm) * 0.8 - Math.max(0, wpm - 210) * 0.8, 0, 100);
  signals.push({ key: 'density', label: 'Densità informativa', score: round(density, 0), detail: `${Math.round(wpm)} parole/min` });

  // 7 payoff clarity: payoff before 75 % of the video
  // First payoff line that survives the edit.
  let payoffAt: number | null = null;
  for (const s of ctx.order.flatMap((id) => ctx.analyses[id]?.sentences ?? []).filter((x) => x.role === 'payoff')) {
    payoffAt = srcToOutput(t.clips, s.mediaId, (s.start + s.end) / 2);
    if (payoffAt !== null) break;
  }
  let payoffScore = 55;
  if (payoffAt !== null) {
    payoffScore = clamp(100 - Math.max(0, payoffAt / d - 0.75) * 300, 0, 100);
    if (payoffAt / d > 0.75) sug.push({ at: payoffAt, text: 'Il payoff arriva molto tardi: prova "rendi l\'hook più forte" per anticiparlo.' });
  } else sug.push({ text: 'Nessun payoff riconoscibile: chiudi con un risultato chiaro.' });
  signals.push({ key: 'payoff', label: 'Chiarezza payoff', score: round(payoffScore, 0), detail: payoffAt !== null ? `a ${payoffAt.toFixed(1)}s` : 'non rilevato' });

  // 8 CTA clarity
  const cta = t.graphics.find((g) => g.properties.kind === 'cta');
  const ctaSpoken = ctx.order.flatMap((id) => ctx.analyses[id]?.sentences ?? []).some((s) => s.role === 'cta');
  const ctaScore = cta ? 100 : ctaSpoken ? 70 : 30;
  if (!cta) sug.push({ text: 'Manca una CTA visiva finale: scrivi "metti una CTA finale".' });
  signals.push({ key: 'cta', label: 'Chiarezza CTA', score: ctaScore, detail: cta ? `"${cta.properties.text}"` : ctaSpoken ? 'solo nel parlato' : 'assente' });

  const weights: Record<string, number> = { hook: 0.22, pacing: 0.14, silence: 0.12, variation: 0.14, readability: 0.12, density: 0.08, payoff: 0.1, cta: 0.08 };
  const score = round(signals.reduce((a, s) => a + s.score * weights[s.key], 0), 0);
  return { score, signals, suggestions: sug.slice(0, 8) };
}
