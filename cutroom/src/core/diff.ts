import type { Timeline } from './timeline';
import { totalLen } from './util';

export interface EditStats {
  duration: number;
  removedSeconds: number;
  removedPauses: number;
  removedFillers: number;
  jumpCuts: number;
  subtitles: number;
  zooms: number;
  graphics: number;
  sfx: number;
  transitions: number;
  patternInterrupts: number;
  cameraMoves: number;
}

export function stats(t: Timeline): EditStats {
  const byKind = (k: string[]) => totalLen(t.cuts.filter((c) => k.includes(c.kind)));
  let jump = 0;
  t.clips.forEach((c, i) => { if (i && t.clips[i - 1].source === c.source) jump++; });
  const graphics = t.graphics.filter((g) => g.properties.kind !== 'progress').length;
  return {
    duration: t.duration,
    removedSeconds: totalLen(t.cuts),
    removedPauses: byKind(['silence']),
    removedFillers: byKind(['filler', 'repeat', 'false_start']),
    jumpCuts: jump,
    subtitles: t.subtitles.length,
    zooms: t.zoom.length,
    graphics,
    sfx: t.audio.length,
    transitions: t.transitions.length,
    patternInterrupts: t.zoom.filter((z) => z.properties.kind !== 'jumpcut').length + graphics + t.transitions.length + t.effects.length,
    cameraMoves: t.zoom.filter((z) => z.properties.kind !== 'jumpcut').length,
  };
}

const s1 = (n: number) => n.toFixed(1).replace('.', ',');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** First edit: "Ho eliminato 4,2s di pause, aggiunto 7 jump cut, sincronizzato 32 sottotitoli e inserito 5 pattern interruption." */
export function describeAutoEdit(t: Timeline): string {
  const st = stats(t);
  const parts = [
    `eliminato ${s1(st.removedPauses)}s di pause${st.removedFillers > 0.05 ? ` e ${s1(st.removedFillers)}s di esitazioni/ripetizioni` : ''}`,
    `aggiunto ${plural(st.jumpCuts, 'jump cut', 'jump cut')}`,
    `sincronizzato ${plural(st.subtitles, 'sottotitolo', 'sottotitoli')}`,
    `inserito ${plural(st.patternInterrupts, 'pattern interruption', 'pattern interruption')} (${st.cameraMoves} movimenti di camera, ${st.graphics} grafiche, ${st.transitions} transizioni, ${st.zooms - st.cameraMoves} cambi di inquadratura sui jump cut) e ${st.sfx} SFX`,
  ];
  return `Ho ${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}. Durata finale ${s1(st.duration)}s.`;
}

/** Incremental change summary between two versions. */
export function describeChange(a: Timeline, b: Timeline): string {
  const x = stats(a);
  const y = stats(b);
  const out: string[] = [];
  const dd = y.duration - x.duration;
  if (Math.abs(dd) >= 0.1) out.push(dd < 0 ? `tolto ${s1(-dd)}s (ora ${s1(y.duration)}s)` : `aggiunto ${s1(dd)}s (ora ${s1(y.duration)}s)`);
  const d = (k: keyof EditStats, one: string, many: string) => {
    const v = (y[k] as number) - (x[k] as number);
    if (v > 0) out.push(`+${plural(v, one, many)}`);
    if (v < 0) out.push(`−${plural(-v, one, many)}`);
  };
  d('jumpCuts', 'jump cut', 'jump cut');
  d('zooms', 'zoom', 'zoom');
  d('graphics', 'grafica', 'grafiche');
  d('sfx', 'SFX', 'SFX');
  d('transitions', 'transizione', 'transizioni');
  d('subtitles', 'sottotitolo', 'sottotitoli');
  const avgZoom = (t: Timeline) => (t.zoom.length ? t.zoom.reduce((acc, z) => acc + z.properties.to, 0) / t.zoom.length : 1);
  const za = avgZoom(a);
  const zb = avgZoom(b);
  if (b.zoom.length && Math.abs(zb - za) > 0.005) out.push(`zoom ${zb > za ? 'più marcati' : 'più leggeri'} (media ${Math.round(za * 100)}%→${Math.round(zb * 100)}%)`);
  const ca = a.settings.captions;
  const cb = b.settings.captions;
  if (cb.fontSize !== ca.fontSize) out.push(`sottotitoli ${cb.fontSize > ca.fontSize ? 'più grandi' : 'più piccoli'} (${ca.fontSize}→${cb.fontSize}px)`);
  if (cb.position !== ca.position) out.push('sottotitoli spostati');
  if (cb.style !== ca.style) out.push(`stile sottotitoli: ${cb.style}`);
  if (a.settings.preset !== b.settings.preset) out.push(`preset ${b.settings.preset.toUpperCase()}`);
  if (a.settings.ctaText !== b.settings.ctaText && b.settings.ctaText) out.push(`CTA "${b.settings.ctaText}"`);
  if (a.metadata.hookSentenceId !== b.metadata.hookSentenceId) out.push('nuovo hook');
  if (!out.length) return 'Nessuna differenza visibile rispetto alla versione precedente.';
  return `Fatto: ${out.join(', ')}.`;
}
