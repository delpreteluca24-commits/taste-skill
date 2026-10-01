import { describe, expect, it } from 'vitest';
import { cleanTranscript } from '../src/core/agents/transcriptClean';
import { autoEdit, applyOps } from '../src/core/engine';
import { runQc } from '../src/core/agents/qc';
import { retentionReport } from '../src/core/agents/score';
import { describeAutoEdit, describeChange } from '../src/core/diff';
import { Timeline } from '../src/core/timeline';
import { PRESETS } from '../src/core/presets';
import { cropWindow } from '../src/core/agents/reframe';
import { demoContext, say, words } from './fixtures';

const sorted = (xs: number[]) => xs.every((x, i) => !i || xs[i - 1] <= x + 1e-9);

function invariants(t: Timeline, order: string[]) {
  expect(() => Timeline.parse(t)).not.toThrow();
  // contiguous clips
  t.clips.forEach((c, i) => {
    if (i) expect(Math.abs(c.start - t.clips[i - 1].end)).toBeLessThan(0.002);
    expect(c.properties.srcEnd).toBeGreaterThan(c.properties.srcStart);
  });
  expect(Math.abs(t.duration - (t.clips.at(-1)?.end ?? 0))).toBeLessThan(0.002);
  // narrative order preserved (teaser excluded)
  const seq = t.clips.filter((c) => c.properties.role !== 'hook').map((c) => order.indexOf(c.source));
  expect(sorted(seq)).toBe(true);
  // within a source, chronological
  for (const id of order) {
    const starts = t.clips.filter((c) => c.source === id && c.properties.role !== 'hook').map((c) => c.properties.srcStart);
    expect(sorted(starts)).toBe(true);
  }
  // subtitles: 1..6 words, inside duration, no overlaps
  t.subtitles.forEach((s, i) => {
    expect(s.properties.words.length).toBeGreaterThan(0);
    expect(s.properties.words.length).toBeLessThanOrEqual(6);
    expect(s.end).toBeLessThanOrEqual(t.duration + 1e-6);
    if (i) expect(s.start).toBeGreaterThanOrEqual(t.subtitles[i - 1].start);
  });
  for (const z of t.zoom) {
    expect(z.properties.to).toBeGreaterThanOrEqual(1);
    expect(z.properties.to).toBeLessThanOrEqual(1.25);
  }
  for (const l of [t.graphics, t.audio, t.zoom, t.transitions]) for (const x of l) expect(x.start).toBeLessThan(t.duration);
}

describe('transcription agent cleanup', () => {
  it('flags repetition loops, words in silence, fillers and false starts', () => {
    const ws = words('X', [
      ['la', 0, 0.2], ['pizza', 0.25, 0.6], ['ciao.', 1, 1.2], ['ciao.', 1.3, 1.5], ['ciao.', 1.6, 1.8], ['ciao.', 1.9, 2.1],
      ['ehm', 2.5, 2.8], ['fantasma', 5.1, 5.6], ['la', 6, 6.2], ['pizza', 6.25, 6.6], ['di', 6.7, 6.8], ['la', 7, 7.2], ['pizza', 7.25, 7.6], ['di', 7.7, 7.8], ['ottobre', 7.9, 8.4],
    ]);
    const out = cleanTranscript(ws, [{ start: 5, end: 5.8 }], 10);
    const flags = (i: number) => out[i].flags;
    expect(flags(2)).not.toContain('hallucination');
    expect(flags(3)).toContain('hallucination');
    expect(flags(5)).toContain('hallucination');
    expect(flags(6)).toContain('filler');
    expect(flags(7)).toContain('hallucination');
    expect(flags(8)).toContain('false_start');
    expect(flags(14)).toEqual([]);
  });
});

describe('auto edit', () => {
  const ctx = demoContext();
  it.each(PRESETS)('preset %s keeps invariants', (p) => {
    const t = autoEdit(ctx, p);
    invariants(t, ctx.order);
    expect(t.clips.length).toBeGreaterThan(3);
    expect(t.subtitles.length).toBeGreaterThan(5);
  });

  it('removes pauses, intro and fillers, and records why', () => {
    const t = autoEdit(ctx, 'premium');
    const kinds = new Set(t.cuts.map((c) => c.kind));
    expect(kinds.has('silence')).toBe(true);
    expect(kinds.has('intro')).toBe(true);
    expect(kinds.has('filler')).toBe(true);
    expect(kinds.has('broll_trim')).toBe(true);
    expect(t.duration).toBeLessThan(44 - 10);
    const text = t.subtitles.map((s) => s.properties.words.map((w) => w.text).join(' ')).join(' ');
    expect(text).not.toMatch(/ehm/);
    expect(text).not.toMatch(/Ciao ragazzi/);
    expect(text).toMatch(/1\.000/);
  });

  it('adds purposeful graphics, zooms and sfx', () => {
    const t = autoEdit(ctx, 'viral');
    expect(t.graphics.some((g) => g.properties.kind === 'counter' && (g.properties.value ?? 0) >= 10)).toBe(true);
    expect(t.graphics.some((g) => g.properties.kind === 'cta')).toBe(true);
    expect(t.zoom.some((z) => z.properties.kind === 'emphasis')).toBe(true);
    expect(t.audio.length).toBeGreaterThan(0);
    for (const x of [...t.graphics, ...t.zoom, ...t.audio]) expect(x.reason.length).toBeGreaterThan(3);
    expect(describeAutoEdit(t)).toMatch(/Ho eliminato .*s di pause/);
  });

  it('minimal preset is restrained', () => {
    const v = autoEdit(ctx, 'viral');
    const m = autoEdit(ctx, 'minimal');
    expect(m.audio.length).toBeLessThan(v.audio.length);
    expect(m.zoom.length).toBeLessThanOrEqual(v.zoom.length);
  });
});

describe('timeline ops (incremental edits)', () => {
  const ctx = demoContext();
  const base = autoEdit(ctx, 'premium');

  it('remove_range cuts the first 5 s and retimes everything', () => {
    const { timeline: t } = applyOps(base, [{ op: 'remove_range', start: 0, end: 5 }], ctx);
    invariants(t, ctx.order);
    expect(base.duration - t.duration).toBeGreaterThan(4.5);
    expect(base.duration - t.duration).toBeLessThan(5.6);
    expect(t.userCuts.length).toBeGreaterThan(0);
  });

  it('set_max_duration respects the budget and keeps the CTA', () => {
    const { timeline: t } = applyOps(base, [{ op: 'set_max_duration', seconds: 15 }], ctx);
    invariants(t, ctx.order);
    expect(t.duration).toBeLessThanOrEqual(16.5);
    const text = t.subtitles.map((s) => s.properties.words.map((w) => w.text).join(' ')).join(' ');
    expect(text).toMatch(/seguimi/i);
  });

  it('caption size change only touches captions', () => {
    const { timeline: t } = applyOps(base, [{ op: 'update_captions', patch: { fontSize: 100 } }], ctx);
    expect(t.settings.captions.fontSize).toBe(100);
    expect(t.clips).toEqual(base.clips);
    expect(t.zoom).toEqual(base.zoom);
    expect(describeChange(base, t)).toMatch(/più grandi/);
  });

  it('remove_effects clears effects but keeps cuts and captions', () => {
    const { timeline: t } = applyOps(autoEdit(ctx, 'viral'), [{ op: 'remove_effects' }], ctx);
    expect(t.zoom.length + t.graphics.length + t.audio.length + t.transitions.length).toBe(0);
    expect(t.subtitles.length).toBeGreaterThan(0);
  });

  it('add_graphic attaches to the spoken phrase and survives a later cut', () => {
    const { timeline: t1 } = applyOps(base, [{ op: 'add_graphic', kind: 'keyword', text: '90 SECONDI', match: '90 secondi' }], ctx);
    const g = t1.graphics.find((x) => x.locked)!;
    expect(g).toBeTruthy();
    const word = t1.subtitles.flatMap((s) => s.properties.words).find((w) => w.text === '90')!;
    expect(Math.abs(g.start - word.start)).toBeLessThan(0.05);
    const { timeline: t2 } = applyOps(t1, [{ op: 'remove_range', start: 0, end: 1 }], ctx);
    const g2 = t2.graphics.find((x) => x.id === g.id)!;
    const word2 = t2.subtitles.flatMap((s) => s.properties.words).find((w) => w.text === '90')!;
    expect(g2.start).toBeLessThan(g.start - 0.5);
    expect(Math.abs(g2.start - word2.start)).toBeLessThan(0.05);
  });

  it('deleted auto elements do not come back on regeneration', () => {
    const v = autoEdit(ctx, 'viral');
    const id = v.graphics.find((g) => g.properties.kind === 'counter')!.id;
    const { timeline: t1 } = applyOps(v, [{ op: 'delete_elements', ids: [id] }], ctx);
    const { timeline: t2 } = applyOps(t1, [{ op: 'regenerate', layers: ['graphics'] }, { op: 'zoom_amount', direction: 'more' }], ctx);
    expect(t2.graphics.some((g) => g.id === id)).toBe(false);
  });

  it('strengthen_hook opens with a cold-open teaser; cutting it disables cold open', () => {
    const { timeline: t } = applyOps(base, [{ op: 'strengthen_hook' }], ctx);
    expect(t.clips[0].properties.role).toBe('hook');
    invariants(t, ctx.order);
    const { timeline: t2 } = applyOps(t, [{ op: 'remove_range', start: 0, end: t.clips[0].end }], ctx);
    expect(t2.clips[0].properties.role).not.toBe('hook');
  });

  it('pacing on a range only tightens that range', () => {
    const slow = applyOps(base, [{ op: 'update_settings', patch: { maxPause: 0.8 } }], ctx).timeline;
    const { timeline: t } = applyOps(slow, [{ op: 'pacing', direction: 'faster', intensity: 'medium', range: { start: 0, end: 8 } }], ctx);
    invariants(t, ctx.order);
    expect(t.duration).toBeLessThanOrEqual(slow.duration);
  });

  it('variation changes the seed deterministically', () => {
    const a = applyOps(base, [{ op: 'variation' }], ctx).timeline;
    const b = applyOps(base, [{ op: 'variation' }], ctx).timeline;
    expect(a.settings.seed).toBe(1);
    expect(a).toEqual(b);
  });
});

describe('QC and score', () => {
  const ctx = demoContext();
  it('fixes subtitles outside the safe area and reports', () => {
    const t = applyOps(autoEdit(ctx, 'premium'), [{ op: 'update_captions', patch: { position: 0.95 } }], ctx).timeline;
    const { timeline, issues } = runQc(t, ctx);
    expect(timeline.settings.captions.position).toBe(0.68);
    expect(issues.some((i) => i.code === 'subtitle_safe_area' && i.fixed)).toBe(true);
  });

  it('retention report has the 8 observable signals', () => {
    const r = retentionReport(autoEdit(ctx, 'viral'), ctx);
    expect(r.signals.map((s) => s.key)).toEqual(['hook', 'pacing', 'silence', 'variation', 'readability', 'density', 'payoff', 'cta']);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('reframe math', () => {
  it('16:9 source is cropped around the face, never outside the frame', () => {
    const w = cropWindow(1920, 1080, { x: 0.9, y: 0.4, mode: 'face' }, 1);
    expect(w.x + w.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(w.w).toBeCloseTo((9 / 16) / (16 / 9), 3);
    const z = cropWindow(1080, 1920, { x: 0.5, y: 0.3, mode: 'face' }, 1.2);
    expect(z.w).toBeCloseTo(1 / 1.2, 3);
    expect(z.y).toBeGreaterThanOrEqual(0);
  });
  it('say() helper sanity', () => expect(say('a b', 0)).toHaveLength(2));
});

describe('ASR artifacts', () => {
  it('drops chunk-overlap duplicates', () => {
    const ws = words('Y', [['sono', 8.0, 8.3], ['fatto', 8.3, 8.6], ['fatto', 8.35, 8.62], ['le', 8.7, 8.8], ['manzi', 8.85, 9.3]]);
    const out = cleanTranscript(ws, [], 20);
    expect(out[2].flags).toContain('hallucination');
    expect(out[1].flags).toEqual([]);
    expect(out[4].flags).toEqual([]);
  });
});

describe('edits never surprise on duration', () => {
  const ctx = demoContext();
  const v = applyOps(autoEdit(ctx, 'viral'), [{ op: 'set_max_duration', seconds: 18 }], ctx).timeline;
  it('removing a range shortens the video even under a duration budget', () => {
    const t = applyOps(v, [{ op: 'remove_range', start: 4, end: 7 }], ctx).timeline;
    expect(t.duration).toBeLessThan(v.duration - 2);
  });
  it('"more dynamic" and a style change never lengthen the edit', () => {
    expect(applyOps(v, [{ op: 'pacing', direction: 'faster', intensity: 'medium' }], ctx).timeline.duration).toBeLessThanOrEqual(v.duration + 0.01);
    expect(applyOps(v, [{ op: 'apply_preset', preset: 'premium' }], ctx).timeline.duration).toBeLessThanOrEqual(Math.ceil(v.duration + 0.5));
  });
  it('a second "stronger hook" picks a different moment', () => {
    const h1 = applyOps(v, [{ op: 'strengthen_hook' }], ctx).timeline;
    const h2 = applyOps(h1, [{ op: 'strengthen_hook' }], ctx).timeline;
    expect(h1.clips[0].properties.role).toBe('hook');
    expect(h2.metadata.hookSentenceId).not.toBe(h1.metadata.hookSentenceId);
  });
});

describe('user graphics make room without breaking the frame', () => {
  it('shortens the title, keeps the progress bar', () => {
    const ctx = demoContext();
    const v = autoEdit(ctx, 'viral');
    const title = v.graphics.find((g) => g.properties.kind === 'title')!;
    const { timeline: t } = applyOps(v, [{ op: 'add_graphic', kind: 'keyword', text: 'TEST', at: title.start + 1.2 }], ctx);
    expect(t.graphics.find((g) => g.properties.kind === 'progress')!.end).toBeCloseTo(t.duration, 2);
    const t2 = t.graphics.find((g) => g.properties.kind === 'title')!;
    expect(t2.end).toBeLessThanOrEqual(title.start + 1.2);
  });
});

describe('templated hallucination loops', () => {
  it('flags a run of same-frame sentences, keeps real speech', () => {
    const text = 'Poi prendiamo la salsiccia. e la nostra domanda è che la nostra città è stata scoperta. La nostra cattà è scopata. La nostra domana è scomposta. La nostra storia è scombata. Un bacio!';
    let t = 0;
    const ws = words('Z', text.split(' ').map((w) => { const x: [string, number, number] = [w, t, t + 0.3]; t += 0.35; return x; }));
    const out = cleanTranscript(ws, [], 60);
    const shown = out.filter((w) => !w.flags.includes('hallucination')).map((w) => w.text).join(' ');
    expect(shown).toBe('Poi prendiamo la salsiccia. Un bacio!');
  });
});
