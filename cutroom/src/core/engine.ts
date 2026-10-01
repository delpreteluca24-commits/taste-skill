import type { Op } from './ops';
import { presetSettings } from './presets';
import type {
  AnyElement, EditContext, EditSettings, GraphicItem, Layer, PresetId, SfxItem, Timeline, ZoomItem,
} from './timeline';
import { buildClips } from './agents/cut';
import { chooseHook, type HookChoice } from './agents/hook';
import { buildSubtitles, mapWords } from './agents/subtitle';
import { buildEffects, buildTransitions, buildZooms } from './agents/camera';
import { buildGraphics } from './agents/motion';
import { buildMusic, buildSfx } from './agents/sound';
import { clampToDuration, layoutClips, outputRangeToSource, retimeAnchored, timelineDuration } from './timemap';
import { norm } from './text';
import { clamp, hashId, round } from './util';

export function emptyTimeline(preset: PresetId, ctx: EditContext): Timeline {
  return {
    version: 1, fps: 30, width: 1080, height: 1920, duration: 0,
    settings: presetSettings(preset),
    clips: [], cuts: [], userCuts: [], wordOverrides: {}, suppressed: [],
    subtitles: [], graphics: [], transitions: [], audio: [], music: [], effects: [], zoom: [],
    metadata: { title: '', sourceOrder: [...ctx.order], hookSentenceId: null, warnings: [] },
  };
}

type ElementLayer = Exclude<Layer, 'clips'>;
const ELEMENT_LAYERS: ElementLayer[] = ['zoom', 'subtitles', 'graphics', 'transitions', 'audio', 'music', 'effects'];

/** Keep locked items, add fresh auto items that are not suppressed and don't sit on top of a locked one. */
function mergeLayer<T extends AnyElement>(current: T[], fresh: T[], suppressed: string[]): T[] {
  const locked = current.filter((x) => x.locked);
  const sup = new Set(suppressed);
  const auto = fresh.filter((f) => !sup.has(f.id) && !locked.some((l) => l.id === f.id || (l.type === f.type && Math.abs(l.start - f.start) < 0.4)));
  return [...locked, ...auto].sort((a, b) => a.start - b.start);
}

/**
 * Regenerates the requested layers (+ their dependents) from the analyses and settings.
 * Locked (user) elements survive and are retimed; everything else is rebuilt deterministically.
 */
export function rebuild(t0: Timeline, ctx: EditContext, requested: Iterable<Layer>): Timeline {
  const layers = new Set<Layer>(requested);
  const t: Timeline = { ...t0, metadata: { ...t0.metadata, sourceOrder: [...ctx.order], warnings: [] } };
  let hook: HookChoice | null;
  if (layers.has('clips')) {
    const r = buildClips(ctx, t.settings, t.userCuts);
    t.clips = r.clips;
    t.cuts = r.cuts;
    hook = r.hook;
    t.metadata.warnings.push(...r.warnings);
    t.duration = round(timelineDuration(t.clips));
    for (const l of ELEMENT_LAYERS) {
      (t as any)[l] = clampToDuration(retimeAnchored(t.clips, (t as any)[l] as AnyElement[]), t.duration);
      layers.add(l);
    }
  } else {
    hook = chooseHook(ctx, t.settings);
  }
  t.metadata.hookSentenceId = hook?.sentence.id ?? null;
  t.metadata.title = hook?.title || t.metadata.title;
  const s = t.settings;
  if (layers.has('zoom')) t.zoom = mergeLayer(t.zoom, buildZooms(ctx, t.clips, s, t.wordOverrides), t.suppressed);
  if (layers.has('transitions')) t.transitions = mergeLayer(t.transitions, buildTransitions(t.clips, s), t.suppressed);
  if (layers.has('effects')) t.effects = mergeLayer(t.effects, buildEffects(ctx, t.clips, s, t.wordOverrides), t.suppressed);
  if (layers.has('subtitles') || layers.has('clips')) t.subtitles = buildSubtitles(ctx, t, s.captions, !s.removeFillers);
  if (layers.has('graphics')) t.graphics = mergeLayer(t.graphics, buildGraphics(ctx, t.clips, s, t.wordOverrides, t.duration, hook), t.suppressed);
  if (layers.has('audio') || layers.has('graphics') || layers.has('transitions') || layers.has('zoom') || layers.has('effects')) {
    t.audio = mergeLayer(t.audio, buildSfx(s, t.graphics, t.transitions, t.zoom, t.effects), t.suppressed);
  }
  if (layers.has('music')) t.music = mergeLayer(t.music, buildMusic(s, ctx.musicId ?? null, t.duration), t.suppressed);
  return t;
}

export function autoEdit(ctx: EditContext, preset: PresetId, base?: Timeline): Timeline {
  const t = base
    ? { ...base, settings: presetSettings(preset, { ctaText: base.settings.ctaText, seed: base.settings.seed }) }
    : emptyTimeline(preset, ctx);
  return rebuild(t, ctx, ['clips']);
}

// ───────────────────────── operations ─────────────────────────

const SETTING_LAYERS: Partial<Record<keyof EditSettings, Layer[]>> = {
  maxPause: ['clips'], padBefore: ['clips'], padAfter: ['clips'], emphasisPause: ['clips'], removeFillers: ['clips'],
  removeIntro: ['clips'], removeFalseStarts: ['clips'], coldOpen: ['clips'], brollShot: ['clips'], brollMaxTotal: ['clips'],
  minShot: ['clips'], maxDuration: ['clips'], seed: ['clips'],
  zoomDensity: ['zoom'], jumpcutZoom: ['zoom'], emphasisZoom: ['zoom'], pushIn: ['zoom'],
  graphicsDensity: ['graphics', 'effects'], titleCard: ['graphics'], progressBar: ['graphics'], ctaText: ['graphics'],
  sfxDensity: ['audio'], sfxVolume: ['audio'], transitionStyle: ['transitions', 'effects'],
  musicVolume: ['music'], duckVolume: ['music'], musicTrack: ['music'], actionPause: ['clips'],
};

const STYLES = ['cut', 'subtle', 'dynamic'] as const;
const stepStyle = (st: EditSettings['transitionStyle'], d: number) => STYLES[clamp(STYLES.indexOf(st) + d, 0, 2)];

export function findElement(t: Timeline, id: string): { layer: Layer; el: AnyElement } | null {
  for (const l of ['clips', ...ELEMENT_LAYERS] as Layer[]) {
    const el = ((t as any)[l] as AnyElement[]).find((x) => x.id === id);
    if (el) return { layer: l, el };
  }
  return null;
}

/** Find the first surviving spoken occurrence of a phrase (numbers normalized: 1.000 = 1000 = mille). */
export function findPhrase(ctx: EditContext, t: Timeline, phrase: string) {
  const canon = (x: string) => {
    const n = norm(x).replace(/[€$%]/g, '');
    if (n === 'mille') return '1000';
    if (/^\d{1,3}(\.\d{3})+$/.test(x.replace(/[€$%,]/g, ''))) return x.replace(/[^\d]/g, '');
    return n.replace(/\./g, '');
  };
  const target = phrase.split(/\s+/).map(canon).filter(Boolean);
  if (!target.length) return null;
  const words = mapWords(ctx, t.clips, t.wordOverrides, true);
  for (let i = 0; i < words.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      const w = words[i + j];
      if (!w || canon(w.raw) !== target[j]) { ok = false; break; }
    }
    if (ok) return { first: words[i], last: words[i + target.length - 1] };
  }
  // Fallback: the most distinctive token alone (e.g. "1000" from "1.000 euro").
  const key = [...target].sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0) || b.length - a.length)[0];
  const hit = words.find((w) => canon(w.raw) === key);
  return hit ? { first: hit, last: hit } : null;
}

function anchorForOutput(t: Timeline, start: number, end: number) {
  const src = outputRangeToSource(t.clips, start, Math.max(end, start + 0.05))[0];
  return src ? { mediaId: src.source, srcStart: src.start, srcEnd: src.end } : undefined;
}

export interface ApplyResult { timeline: Timeline; notes: string[] }

export function applyOps(t0: Timeline, ops: Op[], ctx: EditContext): ApplyResult {
  let t: Timeline = structuredClone(t0);
  const notes: string[] = [];
  for (const op of ops) {
    const layers = new Set<Layer>();
    const s = t.settings;
    switch (op.op) {
      case 'apply_preset': {
        t.settings = presetSettings(op.preset, { ctaText: s.ctaText, seed: s.seed, musicTrack: s.musicTrack ?? null, voiceIsolation: s.voiceIsolation ?? 0.4 });
        // A style change never makes the edit longer than it is now (only shorter, for tighter presets).
        const presetMax = t.settings.maxDuration ?? Infinity;
        const keep = s.maxDuration !== presetSettings(s.preset).maxDuration ? s.maxDuration ?? Infinity : Infinity;
        const cap = Math.min(presetMax, keep, t.duration > 0 ? Math.ceil(t.duration + 0.5) : Infinity);
        t.settings.maxDuration = Number.isFinite(cap) ? cap : null;
        layers.add('clips');
        break;
      }
      case 'update_settings':
        t.settings = { ...s, ...op.patch };
        for (const k of Object.keys(op.patch) as (keyof EditSettings)[]) for (const l of SETTING_LAYERS[k] ?? []) layers.add(l);
        break;
      case 'update_captions':
        t.settings = { ...s, captions: { ...s.captions, ...op.patch } };
        layers.add('subtitles');
        break;
      case 'remove_range': {
        const parts = outputRangeToSource(t.clips, op.start, op.end);
        if (!parts.length) { notes.push('L\'intervallo indicato è fuori dal video.'); break; }
        if (parts.some((p) => p.role === 'hook')) { t.settings = { ...t.settings, coldOpen: false }; }
        t.userCuts = [...t.userCuts, ...parts.filter((p) => p.role !== 'hook').map((p) => ({ source: p.source, start: p.start, end: p.end }))];
        shrinkBudget(t, op.end - op.start);
        layers.add('clips');
        break;
      }
      case 'restore_cuts':
        t.userCuts = [];
        layers.add('clips');
        break;
      case 'set_max_duration':
        t.settings = { ...s, maxDuration: op.seconds };
        if (op.seconds) t.settings.brollMaxTotal = Math.min(s.brollMaxTotal, Math.max(op.seconds * 0.15, s.brollShot));
        layers.add('clips');
        break;
      case 'set_duration_range': {
        const lo = Math.min(op.min, op.max);
        const hi = Math.max(op.min, op.max);
        t = fitDuration(t, ctx, lo, hi, notes);
        break;
      }
      case 'structure_sections': {
        // Logical order beats a teaser: no cold open, keep the speaker's own intro.
        t.settings = { ...t.settings, coldOpen: false, removeIntro: false, titleCard: false };
        t = rebuild(t, ctx, ['clips']);
        t.graphics = [...t.graphics.filter((g) => !(g.properties.kind === 'label' && g.locked)), ...sectionLabels(t, ctx, op.labels)].sort((a, b) => a.start - b.start);
        layers.add('audio');
        break;
      }
      case 'pacing': {
        const k = { low: 0.5, medium: 1, high: 1.6 }[op.intensity];
        const faster = op.direction === 'faster';
        if (op.range) {
          const added = tightenRange(t, ctx, op.range.start, op.range.end, faster ? Math.max(0.05, s.maxPause * (1 - 0.45 * k)) : s.maxPause);
          if (faster) addRangeZooms(t, ctx, op.range.start, op.range.end, k);
          notes.push(added ? `Ritmo aumentato tra ${fmt(op.range.start)} e ${fmt(op.range.end)}.` : `Nessuna pausa da accorciare tra ${fmt(op.range.start)} e ${fmt(op.range.end)}: ho aggiunto movimento di camera.`);
          layers.add(added ? 'clips' : 'zoom');
          break;
        }
        if (faster) shrinkBudget(t, 0);
        else if (t.settings.maxDuration) t.settings = { ...t.settings, maxDuration: Math.ceil(Math.max(t.settings.maxDuration, t.duration * (1 + 0.25 * k))) };
        const f = faster ? 1 - 0.4 * k : 1 + 0.5 * k;
        const d = faster ? 0.2 * k : -0.2 * k;
        t.settings = {
          ...s,
          maxDuration: t.settings.maxDuration,
          maxPause: round(clamp(s.maxPause * f, 0.05, 0.8), 3),
          padAfter: round(clamp(s.padAfter * (faster ? 0.85 : 1.15), 0.04, 0.25), 3),
          brollShot: round(clamp(s.brollShot * (faster ? 0.8 : 1.2), 0.7, 3.5), 2),
          zoomDensity: round(clamp(s.zoomDensity + d, 0, 1), 2),
          sfxDensity: round(clamp(s.sfxDensity + d * 0.7, 0, 1), 2),
          graphicsDensity: round(clamp(s.graphicsDensity + d * 0.5, 0, 1), 2),
          transitionStyle: stepStyle(s.transitionStyle, faster ? 1 : -1),
          captions: { ...s.captions, maxWords: clamp(s.captions.maxWords + (faster ? -1 : 1), 2, 6), minWords: clamp(Math.min(s.captions.minWords, s.captions.maxWords + (faster ? -1 : 1)), 1, 4) },
        };
        layers.add('clips');
        break;
      }
      case 'zoom_amount': {
        const m = op.direction === 'more' ? 1 : -1;
        t.settings = {
          ...s,
          zoomDensity: round(clamp(s.zoomDensity + 0.25 * m, 0, 1), 2),
          jumpcutZoom: round(clamp(s.jumpcutZoom + 0.02 * m, 1.02, 1.16), 3),
          emphasisZoom: round(clamp(s.emphasisZoom + 0.03 * m, 1.04, 1.25), 3),
          pushIn: m > 0 ? true : s.pushIn && s.zoomDensity - 0.25 > 0.2,
        };
        layers.add('zoom');
        break;
      }
      case 'sfx_amount':
        t.settings = { ...s, sfxDensity: op.direction === 'none' ? 0 : round(clamp(s.sfxDensity + (op.direction === 'more' ? 0.25 : -0.3), 0, 1), 2) };
        if (op.direction === 'none') t.audio = [];
        layers.add('audio');
        break;
      case 'graphics_amount':
        t.settings = { ...s, graphicsDensity: op.direction === 'none' ? 0 : round(clamp(s.graphicsDensity + (op.direction === 'more' ? 0.25 : -0.3), 0, 1), 2), titleCard: op.direction === 'none' ? false : s.titleCard, progressBar: op.direction === 'none' ? false : s.progressBar };
        if (op.direction === 'none') t.graphics = [];
        layers.add('graphics');
        break;
      case 'remove_effects':
        t.settings = { ...s, zoomDensity: 0, pushIn: false, graphicsDensity: 0, titleCard: false, progressBar: false, sfxDensity: 0, transitionStyle: 'cut' };
        t.zoom = []; t.graphics = []; t.transitions = []; t.audio = []; t.effects = [];
        ['zoom', 'graphics', 'transitions', 'audio', 'effects'].forEach((l) => layers.add(l as Layer));
        break;
      case 'add_graphic': {
        let start = op.at ?? 0;
        let anchor = undefined as GraphicItem['anchor'];
        let found = false;
        if (op.match) {
          const hit = findPhrase(ctx, t, op.match);
          if (hit) {
            start = hit.first.start;
            found = true;
            const dur = op.duration ?? 1.8;
            anchor = { mediaId: hit.first.source, srcStart: hit.first.srcStart, srcEnd: hit.first.srcStart + dur };
          } else notes.push(`Non trovo "${op.match}" nel parlato: ho messo la grafica ${op.at !== undefined ? `a ${fmt(op.at)}` : 'all\'inizio'}.`);
        }
        const dur = op.duration ?? (op.kind === 'fullscreen' ? 1 : 1.8);
        const end = Math.min(t.duration, start + dur);
        anchor ??= anchorForOutput(t, start, end);
        const num = parseFloat(op.text.replace(/[^\d,]/g, '').replace(',', '.'));
        const kind = op.kind === 'keyword' && /\d/.test(op.text) && num >= 10 ? 'counter' : op.kind;
        const g: GraphicItem = {
          id: hashId('gu', op.kind, start, op.text), type: 'graphic', start: round(start), end: round(end), layer: 5, locked: true,
          reason: found ? `Richiesta: grafica su "${op.match}"` : 'Richiesta utente', anchor,
          properties: kind === 'counter'
            ? { kind, text: op.text.toUpperCase(), value: num, prefix: /€|euro/i.test(op.text) ? '€' : undefined, suffix: /€|euro/i.test(op.text) ? undefined : op.text.replace(/^[^\d]*[\d.,]+\s*/, '').toUpperCase() || undefined, position: 'top' }
            : { kind, text: op.text.toUpperCase(), position: op.kind === 'fullscreen' ? 'center' : op.kind === 'lowerThird' ? 'bottom' : 'top' },
        };
        // Auto graphics in the same slot make room: shortened if ≥ 0.8 s remains before the new one, else removed.
        t.graphics = [
          ...t.graphics.flatMap((x) => {
            if (x.locked || x.properties.kind === 'progress' || x.properties.position !== g.properties.position || !(x.start < g.end && x.end > g.start)) return [x];
            return g.start - 0.1 - x.start >= 0.8 ? [{ ...x, end: round(g.start - 0.1) }] : [];
          }),
          g,
        ];
        layers.add('audio');
        break;
      }
      case 'add_cta':
        t.settings = { ...s, ctaText: op.text };
        layers.add('graphics');
        break;
      case 'add_sfx': {
        const sfx: SfxItem = {
          id: hashId('sfxu', op.name, op.at), type: 'sfx', start: round(op.at), end: round(op.at + 0.6), layer: 9, locked: true,
          reason: 'Richiesta utente', anchor: anchorForOutput(t, op.at, op.at + 0.6), properties: { name: op.name, volume: round(0.7 * s.sfxVolume + 0.15, 3) },
        };
        t.audio = [...t.audio, sfx].sort((a, b) => a.start - b.start);
        break;
      }
      case 'add_zoom': {
        const z: ZoomItem = {
          id: hashId('zu', op.start, op.end), type: 'zoom', start: round(op.start), end: round(Math.min(op.end, t.duration)), layer: 2, locked: true,
          reason: 'Richiesta utente', anchor: anchorForOutput(t, op.start, op.end), properties: { kind: 'manual', from: 1, to: op.scale, ease: 0.15 },
        };
        t.zoom = [...t.zoom, z].sort((a, b) => a.start - b.start);
        break;
      }
      case 'strengthen_hook':
        if (!s.coldOpen) t.settings = { ...s, coldOpen: true, removeIntro: true, titleCard: true };
        else t.settings = { ...s, seed: s.seed + 1, titleCard: true };
        layers.add('clips');
        break;
      case 'set_word_text':
        t.wordOverrides = { ...t.wordOverrides, [op.wordId]: op.text };
        layers.add('subtitles');
        break;
      case 'update_element': {
        const f = findElement(t, op.id);
        if (!f) { notes.push(`Elemento ${op.id} non trovato.`); break; }
        if (f.layer === 'clips' || f.layer === 'subtitles') { notes.push('Clip e sottotitoli si modificano con tagli e correzioni di testo.'); break; }
        const el: any = { ...f.el, locked: true };
        if (op.patch.start !== undefined) el.start = clamp(op.patch.start, 0, t.duration);
        if (op.patch.end !== undefined) el.end = clamp(op.patch.end, el.start + 0.1, t.duration);
        if (op.patch.properties) el.properties = { ...el.properties, ...op.patch.properties };
        if (op.patch.start !== undefined || op.patch.end !== undefined) el.anchor = anchorForOutput(t, el.start, el.end);
        (t as any)[f.layer] = ((t as any)[f.layer] as AnyElement[]).map((x) => (x.id === op.id ? el : x));
        break;
      }
      case 'delete_elements':
        for (const id of op.ids) {
          const f = findElement(t, id);
          if (!f) continue;
          if (f.layer === 'clips') {
            const c = f.el as Timeline['clips'][number];
            if (c.properties.role === 'hook') t.settings = { ...t.settings, coldOpen: false };
            else t.userCuts = [...t.userCuts, { source: c.source, start: c.properties.srcStart, end: c.properties.srcEnd }];
            shrinkBudget(t, c.end - c.start);
            layers.add('clips');
          } else {
            (t as any)[f.layer] = ((t as any)[f.layer] as AnyElement[]).filter((x) => x.id !== id);
            if (!f.el.locked) t.suppressed = [...t.suppressed, id];
          }
        }
        break;
      case 'regenerate':
        op.layers.forEach((l) => layers.add(l));
        break;
      case 'variation':
        t.settings = { ...s, seed: s.seed + 1 };
        layers.add('clips');
        break;
    }
    if (layers.size) t = rebuild(t, ctx, layers);
  }
  return { timeline: t, notes };
}

/**
 * Duration fitting: the cut agent only ever shortens (story budget), so to reach a minimum we keep more of the
 * material — longer pauses/breaths, more B-roll — step by step, and stop at the first edit inside the range.
 */
function fitDuration(t0: Timeline, ctx: EditContext, lo: number, hi: number, notes: string[]): Timeline {
  let s = { ...t0.settings, maxDuration: hi, brollMaxTotal: Math.max(t0.settings.brollMaxTotal, 6) };
  let best = rebuild({ ...t0, settings: s }, ctx, ['clips']);
  for (let i = 0; i < 8 && best.duration < lo; i++) {
    s = {
      ...s,
      maxPause: round(Math.min(1.2, s.maxPause * 1.35 + 0.05), 3),
      padAfter: round(Math.min(0.3, s.padAfter + 0.03), 3),
      emphasisPause: round(Math.min(0.6, s.emphasisPause + 0.05), 3),
      brollShot: round(Math.min(3.5, s.brollShot + 0.3), 2),
      brollMaxTotal: round(Math.min(hi * 0.3, s.brollMaxTotal + 3), 2),
      actionPause: round(Math.min(4, (s.actionPause ?? 0) + 0.8), 2),
    };
    best = rebuild({ ...t0, settings: s }, ctx, ['clips']);
  }
  if (best.duration < lo) notes.push(`Con il materiale utile arrivo a ${Math.round(best.duration)}s: per superare ${lo}s servirebbe più parlato o B-roll.`);
  return best;
}

/** Chapter labels at the first shot of each section (sections split the story clips in narrative order). */
function sectionLabels(t: Timeline, ctx: EditContext, labels: string[]): GraphicItem[] {
  const order = ctx.order.filter((id) => t.clips.some((c) => c.source === id));
  if (!order.length) return [];
  const n = labels.length;
  // first media → first label, last media → last label, the rest share the middle labels.
  const groups: string[][] = Array.from({ length: n }, () => []);
  order.forEach((id, i) => {
    const g = i === 0 ? 0 : i === order.length - 1 ? n - 1 : Math.min(n - 2, 1 + Math.floor(((i - 1) / Math.max(1, order.length - 2)) * (n - 2)));
    groups[order.length === 1 ? 0 : g].push(id);
  });
  const out: GraphicItem[] = [];
  groups.forEach((ids, gi) => {
    const first = t.clips.find((c) => ids.includes(c.source) && c.properties.role !== 'hook');
    if (!first) return;
    const start = first.start + (gi === 0 ? 0.15 : 0.1);
    const end = Math.min(first.end + 1.5, start + 2.2, t.duration);
    out.push({
      id: hashId('gs', gi, labels[gi]), type: 'graphic', start: round(start), end: round(end), layer: 6, locked: true,
      reason: `Capitolo "${labels[gi]}": rende leggibile la struttura del racconto`,
      anchor: { mediaId: first.source, srcStart: first.properties.srcStart + (start - first.start), srcEnd: first.properties.srcStart + (end - first.start) },
      properties: { kind: 'label', text: labels[gi].toUpperCase(), position: 'top' },
    });
  });
  return out;
}

/** Removing material must make the edit shorter: lower the duration budget so trimmed spans don't come back. */
function shrinkBudget(t: Timeline, removed: number) {
  if (t.duration <= 0) return;
  const target = Math.max(3, Math.ceil(t.duration - removed + 0.05));
  t.settings = { ...t.settings, maxDuration: Math.min(t.settings.maxDuration ?? Infinity, target) };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Remove pauses longer than `maxPause` inside an output range (adds user cuts on the gaps). */
function tightenRange(t: Timeline, ctx: EditContext, start: number, end: number, maxPause: number): boolean {
  const words = mapWords(ctx, t.clips, t.wordOverrides, true).filter((w) => w.start >= start && w.end <= end);
  let added = false;
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1];
    const b = words[i];
    if (a.clipId !== b.clipId) continue;
    const gap = b.start - a.end;
    if (gap > maxPause + 0.12) {
      const s0 = a.srcStart + (a.end - a.start) + 0.06;
      const s1 = b.srcStart - 0.05;
      if (s1 - s0 > 0.05) {
        t.userCuts.push({ source: a.source, start: round(s0), end: round(s1) });
        added = true;
      }
    }
  }
  return added;
}

function addRangeZooms(t: Timeline, ctx: EditContext, start: number, end: number, k: number) {
  const words = mapWords(ctx, t.clips, t.wordOverrides, false).filter((w) => w.start >= start && w.end <= end);
  let last = -Infinity;
  const gap = 3.2 / k;
  for (const w of words) {
    if (w.start - last < gap) continue;
    const zEnd = Math.min(end, w.start + 1.4);
    t.zoom.push({
      id: hashId('zr', w.id), type: 'zoom', start: round(w.start), end: round(zEnd), layer: 2, locked: true,
      reason: 'Ritmo: punch-in nel tratto richiesto',
      anchor: { mediaId: w.source, srcStart: w.srcStart, srcEnd: w.srcStart + (zEnd - w.start) },
      properties: { kind: 'emphasis', from: 1, to: round(t.settings.emphasisZoom, 3), ease: 0.12 },
    });
    last = w.start;
  }
}

/** Version 1 "Original": every clip in full, in upload order, captions only — the baseline to compare against. */
export function originalTimeline(ctx: EditContext): Timeline {
  const t = emptyTimeline('minimal', ctx);
  t.settings = {
    ...t.settings, coldOpen: false, removeFillers: false, removeIntro: false, removeFalseStarts: false, maxDuration: null,
    zoomDensity: 0, pushIn: false, graphicsDensity: 0, titleCard: false, progressBar: false, sfxDensity: 0, transitionStyle: 'cut', grade: 'none',
  };
  const clips = ctx.order
    .filter((id) => ctx.analyses[id])
    .map((id) => {
      const a = ctx.analyses[id];
      return {
        id: hashId('clip', id, 'orig'), type: 'clip' as const, source: id, start: 0, end: 0, layer: 0, reason: 'Clip originale completa',
        properties: { srcStart: 0, srcEnd: round(a.raw.duration), speed: 1, volume: 1, role: a.kind, crop: { x: 0.5, y: 0.42, mode: 'center' as const } },
      };
    });
  t.clips = layoutClips(clips);
  t.duration = round(timelineDuration(t.clips));
  return rebuild(t, ctx, ['subtitles', 'music']);
}
