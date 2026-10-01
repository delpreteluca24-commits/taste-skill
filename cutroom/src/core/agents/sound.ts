import type { EditSettings, EffectItem, GraphicItem, MusicItem, SfxItem, SfxName, TransitionItem, ZoomItem } from '../timeline';
import { hashId, round } from '../util';

const GAIN: Record<SfxName, number> = { whoosh: 0.7, pop: 0.8, click: 0.7, hit: 0.75, riser: 0.5, impact: 0.8, swipe: 0.7, notification: 0.6, ding: 0.6 };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Trigger { t: number; name: SfxName; priority: number; why: string; anchor?: SfxItem['anchor']; len: number }

/**
 * Sound Design Agent: every SFX is attached to a visual event (graphic, transition, punch-in).
 * Density cap = minimum spacing; higher-priority events win. Voice stays on top (SFX gain ≤ 0.8 × sfxVolume).
 */
export function buildSfx(s: EditSettings, graphics: GraphicItem[], transitions: TransitionItem[], zooms: ZoomItem[], effects: EffectItem[]): SfxItem[] {
  if (s.sfxDensity <= 0) return [];
  const trig: Trigger[] = [];
  for (const tr of transitions) {
    const name: SfxName = tr.properties.kind === 'flash' ? 'impact' : tr.properties.kind === 'swipe' ? 'swipe' : 'whoosh';
    trig.push({ t: Math.max(0, tr.properties.at - 0.12), name, priority: 3, why: `Transizione ${tr.properties.kind}`, len: 0.6 });
  }
  for (const g of graphics) {
    const k = g.properties.kind;
    if (k === 'progress') continue;
    const name: SfxName = k === 'counter' ? 'hit' : k === 'cta' ? 'notification' : k === 'title' || k === 'photo' ? 'whoosh' : k === 'fullscreen' || k === 'slogan' ? 'impact' : k === 'lowerThird' ? 'swipe' : 'pop';
    trig.push({ t: k === 'photo' ? Math.max(0, g.start - 0.12) : g.start, name, priority: k === 'fullscreen' || k === 'cta' || k === 'slogan' || k === 'photo' ? 3 : 2, why: `Grafica ${k}`, anchor: g.anchor ? { ...g.anchor, srcEnd: g.anchor.srcStart + 0.6 } : undefined, len: 0.6 });
    if (k === 'fullscreen' && s.sfxDensity >= 0.6 && g.start > 1.4) {
      trig.push({ t: g.start - 1.2, name: 'riser', priority: 2, why: 'Tensione prima del payoff', len: 1.2 });
    }
  }
  if (s.sfxDensity >= 0.6) {
    for (const z of zooms) {
      if (z.properties.kind !== 'emphasis') continue;
      trig.push({ t: z.start, name: 'click', priority: 1, why: 'Punch-in di enfasi', anchor: z.anchor ? { ...z.anchor, srcEnd: z.anchor.srcStart + 0.4 } : undefined, len: 0.4 });
    }
  }
  for (const e of effects) trig.push({ t: e.start, name: 'impact', priority: 2, why: 'Flash pattern interruption', anchor: e.anchor, len: 0.6 });

  const minGap = lerp(5, 1.1, s.sfxDensity);
  const chosen: Trigger[] = [];
  for (const x of [...trig].sort((a, b) => b.priority - a.priority || a.t - b.t)) {
    if (chosen.some((c) => Math.abs(c.t - x.t) < minGap * (x.name === 'riser' || c.name === 'riser' ? 0.4 : 1))) continue;
    chosen.push(x);
  }
  return chosen
    .sort((a, b) => a.t - b.t)
    .map((x) => ({
      id: hashId('sfx', x.name, round(x.t, 2)), type: 'sfx' as const, start: round(x.t), end: round(x.t + x.len), layer: 9,
      reason: x.why, anchor: x.anchor,
      properties: { name: x.name, volume: round(GAIN[x.name] * s.sfxVolume, 3) },
    }));
}

export const BUILTIN_MUSIC: Record<string, string> = { tarantella: 'Tarantella (generata, mandolino e chitarra)' };

/** Uploaded track wins; otherwise the chosen built-in track (`builtin:<name>`). */
export function buildMusic(s: EditSettings, uploadedId: string | null, duration: number): MusicItem[] {
  const musicMediaId = uploadedId ?? (s.musicTrack && BUILTIN_MUSIC[s.musicTrack] ? `builtin:${s.musicTrack}` : null);
  if (!musicMediaId || duration <= 0) return [];
  return [{
    id: hashId('mus', musicMediaId), type: 'music', source: musicMediaId, start: 0, end: round(duration), layer: 10,
    reason: 'Musica di sottofondo con ducking automatico sul parlato',
    properties: { volume: s.musicVolume, duckVolume: s.duckVolume, fadeIn: 0.6, fadeOut: 1.2 },
  }];
}
