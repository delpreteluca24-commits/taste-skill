import type { EditContext, Timeline } from '../timeline';
import { charsPerLine } from './subtitle';
import { cropWindow, faceInside } from './reframe';
import { overlap } from '../util';
import { buildSubtitles } from './subtitle';

export interface QcIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  at?: number;
  fixed: boolean;
}

const MAX_SHORTS = 180;

/**
 * VIDEO_QC — runs before every export. Auto-fixes what is safe to fix, warns about the rest.
 * Returns a NEW timeline (never mutates the input).
 */
export function runQc(t0: Timeline, ctx: EditContext): { timeline: Timeline; issues: QcIssue[] } {
  const t: Timeline = structuredClone(t0);
  const issues: QcIssue[] = [];
  const add = (i: QcIssue) => issues.push(i);

  // missing media
  const missing = t.clips.filter((c) => !ctx.analyses[c.source]);
  if (missing.length) {
    t.clips = t.clips.filter((c) => ctx.analyses[c.source]);
    add({ code: 'missing_media', severity: 'error', message: `${missing.length} clip con media mancante rimosse.`, fixed: true });
  }
  if (!t.clips.length) add({ code: 'empty', severity: 'error', message: 'La timeline è vuota.', fixed: false });

  // invalid duration
  if (t.duration > 0 && t.duration < 3) add({ code: 'duration_short', severity: 'warning', message: `Durata ${t.duration.toFixed(1)}s: troppo corta per un short.`, fixed: false });
  if (t.duration > MAX_SHORTS) add({ code: 'duration_long', severity: 'warning', message: `Durata ${Math.round(t.duration)}s: oltre i 3 minuti (limite Shorts, da riverificare). Prova "massimo 60 secondi".`, fixed: false });

  // bad cuts (flash frames)
  t.clips.forEach((c) => {
    if (c.end - c.start < 0.3) add({ code: 'bad_cut', severity: 'warning', message: `Inquadratura di ${(c.end - c.start).toFixed(2)}s (flash).`, at: c.start, fixed: false });
  });

  // black / frozen frames inside kept ranges
  for (const c of t.clips) {
    const raw = ctx.analyses[c.source]?.raw;
    if (!raw) continue;
    const span = { start: c.properties.srcStart, end: c.properties.srcEnd };
    if (raw.black.some((b) => overlap(b, span) > 0.1)) add({ code: 'black_frames', severity: 'warning', message: 'Frame neri in una clip.', at: c.start, fixed: false });
    if (raw.freeze.some((f) => overlap(f, span) > 0.8)) add({ code: 'frozen_frames', severity: 'info', message: 'Immagine ferma per quasi 1s.', at: c.start, fixed: false });
    if (raw.loudness.truePeak > -1 && !issues.some((i) => i.code === 'audio_clipping' && i.message.includes(c.source))) {
      add({ code: 'audio_clipping', severity: 'info', message: `Picchi audio a ${raw.loudness.truePeak.toFixed(1)} dBTP nella clip ${c.source}: limiter applicato in export.`, fixed: true });
    }
  }

  // duplicated frames: same source range used twice outside the cold-open teaser and gag inserts (repeated on purpose)
  const story = t.clips.filter((c) => c.properties.role !== 'hook' && c.properties.role !== 'insert');
  for (let i = 0; i < story.length; i++) for (let j = i + 1; j < story.length; j++) {
    const a = story[i]; const b = story[j];
    if (a.source === b.source && overlap({ start: a.properties.srcStart, end: a.properties.srcEnd }, { start: b.properties.srcStart, end: b.properties.srcEnd }) > 0.2) {
      add({ code: 'duplicated_frames', severity: 'warning', message: 'Lo stesso pezzo di video compare due volte.', at: b.start, fixed: false });
    }
  }

  // face cropping
  for (const c of t.clips) {
    const raw = ctx.analyses[c.source]?.raw;
    if (!raw || c.properties.crop.mode !== 'face') continue;
    const maxZoom = Math.max(1, ...t.zoom.filter((z) => z.start < c.end && z.end > c.start).map((z) => z.properties.to));
    const win = cropWindow(raw.width, raw.height, c.properties.crop, maxZoom);
    if (!faceInside(win, c.properties.crop)) {
      add({ code: 'face_cropping', severity: 'warning', message: 'Volto vicino al bordo del 9:16 in questa inquadratura.', at: c.start, fixed: false });
    }
  }

  // subtitles: safe area + overflow + consistency
  const cs = t.settings.captions;
  if (cs.position > 0.8 || cs.position < 0.12) {
    t.settings.captions = { ...cs, position: 0.68 };
    add({ code: 'subtitle_safe_area', severity: 'warning', message: 'Sottotitoli fuori dalla safe area di TikTok/Reels: riportati al 68%.', fixed: true });
  }
  const maxChars = charsPerLine(t.settings.captions.fontSize) * 2;
  const longest = Math.max(0, ...t.subtitles.map((s) => s.properties.words.reduce((a, w) => a + w.text.length + 1, 0)));
  if (longest > maxChars) {
    t.settings.captions = { ...t.settings.captions, maxWords: Math.max(2, t.settings.captions.maxWords - 1) };
    t.subtitles = buildSubtitles(ctx, t, t.settings.captions, !t.settings.removeFillers);
    add({ code: 'subtitle_overflow', severity: 'warning', message: 'Sottotitoli troppo lunghi per la riga: gruppi più corti.', fixed: true });
  }
  const overl = t.subtitles.filter((s, i) => i && s.start < t.subtitles[i - 1].end - 0.01);
  if (overl.length) {
    t.subtitles = t.subtitles.map((s, i) => (t.subtitles[i + 1] && s.end > t.subtitles[i + 1].start ? { ...s, end: t.subtitles[i + 1].start } : s));
    add({ code: 'inconsistent_subtitles', severity: 'info', message: `${overl.length} sottotitoli sovrapposti allineati.`, fixed: true });
  }

  // excessive SFX: more than 2 within 1 s
  const sfx = [...t.audio].sort((a, b) => a.start - b.start);
  const keep = sfx.filter((s, i) => !(i >= 2 && s.start - sfx[i - 2].start < 1));
  if (keep.length < sfx.length) {
    t.audio = keep;
    add({ code: 'excessive_sfx', severity: 'warning', message: `${sfx.length - keep.length} SFX troppo ravvicinati rimossi.`, fixed: true });
  }
  if (t.duration > 0 && t.audio.length / t.duration > 0.6) add({ code: 'sfx_density', severity: 'warning', message: 'Molti SFX: prova "usa meno SFX".', fixed: false });

  // music level
  t.music = t.music.map((m) => {
    if (m.properties.volume > 0.35) {
      add({ code: 'music_loud', severity: 'warning', message: 'Musica troppo alta rispetto alla voce: abbassata.', fixed: true });
      return { ...m, properties: { ...m.properties, volume: 0.25 } };
    }
    return m;
  });

  // graphics collision (same region, overlapping in time)
  const gs = t.graphics.filter((g) => g.properties.kind !== 'progress').sort((a, b) => a.start - b.start);
  const drop = new Set<string>();
  for (let i = 1; i < gs.length; i++) {
    const prev = gs.slice(0, i).filter((g) => !drop.has(g.id) && g.properties.position === gs[i].properties.position);
    if (prev.some((p) => p.end > gs[i].start + 0.05)) {
      if (gs[i].locked) prev.filter((p) => !p.locked && p.end > gs[i].start).forEach((p) => drop.add(p.id));
      else drop.add(gs[i].id);
    }
  }
  if (drop.size) {
    t.graphics = t.graphics.filter((g) => !drop.has(g.id));
    add({ code: 'graphics_collision', severity: 'warning', message: `${drop.size} grafiche sovrapposte rimosse.`, fixed: true });
  }

  // elements past the end
  for (const l of ['graphics', 'audio', 'zoom', 'transitions', 'effects', 'music'] as const) {
    (t as any)[l] = ((t as any)[l] as { start: number; end: number }[]).filter((x) => x.start < t.duration).map((x) => (x.end > t.duration ? { ...x, end: t.duration } : x));
  }
  const lowLoud = t.clips.map((c) => ctx.analyses[c.source]?.raw.loudness.integrated ?? 0).filter((l) => l < -35);
  if (lowLoud.length) add({ code: 'low_voice', severity: 'info', message: 'Audio sorgente molto basso: normalizzato a -14 LUFS in export.', fixed: true });
  return { timeline: t, issues };
}
