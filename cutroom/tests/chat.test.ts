import { describe, expect, it } from 'vitest';
import { interpret } from '../src/core/interpreter';
import { autoEdit, applyOps } from '../src/core/engine';
import { canRedo, canUndo, checkout, commit, emptyHistory, redo, undo } from '../src/core/history';
import { OpList } from '../src/core/ops';
import { demoContext } from './fixtures';

const ctx = demoContext();
const t = autoEdit(ctx, 'premium');
const run = (msg: string, extra: Partial<Parameters<typeof interpret>[2]> = {}) => interpret(msg, t, { playhead: 3, ...extra });
const ops = (msg: string, extra = {}) => {
  const r = run(msg, extra);
  if (r.kind !== 'ops') throw new Error(`no ops for "${msg}": ${r.reply}`);
  OpList.parse(r.ops);
  return r.ops;
};

describe('chat command interpreter — spec examples', () => {
  it('Taglia i primi 5 secondi', () => expect(ops('Taglia i primi 5 secondi')).toEqual([{ op: 'remove_range', start: 0, end: 5 }]));
  it('Rendi il video più dinamico', () => expect(ops('Rendi il video più dinamico')[0]).toMatchObject({ op: 'pacing', direction: 'faster' }));
  it('Fai i sottotitoli più grandi', () => expect(ops('Fai i sottotitoli più grandi')[0]).toMatchObject({ op: 'update_captions' }));
  it('Metti più zoom', () => expect(ops('Metti più zoom')).toEqual([{ op: 'zoom_amount', direction: 'more' }]));
  it('Togli tutti gli effetti', () => expect(ops('Togli tutti gli effetti')).toEqual([{ op: 'remove_effects' }]));
  it('Rendi lo stile più premium', () => expect(ops('Rendi lo stile più premium')).toEqual([{ op: 'apply_preset', preset: 'premium' }]));
  it('Metti una grafica quando parlo dei 1.000 euro', () =>
    expect(ops('Metti una grafica quando parlo dei 1.000 euro')[0]).toMatchObject({ op: 'add_graphic', text: '€1.000', match: '1.000 euro' }));
  it('Taglia questa parte (selection)', () =>
    expect(ops('Taglia questa parte', { selection: { start: 4, end: 6 } })).toEqual([{ op: 'remove_range', start: 4, end: 6 }]));
  it('Taglia questa parte (playhead → current shot)', () => expect(ops('Taglia questa parte')[0]).toMatchObject({ op: 'delete_elements' }));
  it('Fai durare il video massimo 30 secondi', () => expect(ops('Fai durare il video massimo 30 secondi')).toEqual([{ op: 'set_max_duration', seconds: 30 }]));
  it('Rendi l\'hook più forte', () => expect(ops('Rendi l\'hook più forte')).toEqual([{ op: 'strengthen_hook' }]));
  it('Usa meno SFX', () => expect(ops('Usa meno SFX')).toEqual([{ op: 'sfx_amount', direction: 'less' }]));
  it('Metti una CTA finale', () => expect(ops('Metti una CTA finale')[0]).toMatchObject({ op: 'add_cta' }));
  it('Fai una versione più aggressiva', () => expect(ops('Fai una versione più aggressiva')).toEqual([{ op: 'apply_preset', preset: 'fast' }]));
  it('Rendi più dinamico il minuto iniziale', () =>
    expect(ops('Rendi più dinamico il minuto iniziale')[0]).toMatchObject({ op: 'pacing', direction: 'faster', range: { start: 0 } }));
  it('undo / unknown', () => {
    expect(run('annulla').kind).toBe('history');
    expect(run('fammi un caffè').kind).toBe('unknown');
  });
  it('every spec command applies cleanly', () => {
    for (const m of ['Taglia i primi 5 secondi', 'Rendi il video più dinamico', 'Fai i sottotitoli più grandi', 'Metti più zoom', 'Togli tutti gli effetti',
      'Rendi lo stile più premium', 'Metti una grafica quando parlo dei 1.000 euro', 'Fai durare il video massimo 30 secondi', 'Rendi l\'hook più forte',
      'Usa meno SFX', 'Metti una CTA finale', 'Fai una versione più aggressiva']) {
      const r = applyOps(t, ops(m), ctx);
      expect(r.timeline.clips.length).toBeGreaterThan(0);
    }
  });
});

describe('version history', () => {
  it('undo / redo / checkout across branches', () => {
    let h = emptyHistory();
    h = commit(h, { id: 'v1', label: 'Original', author: 'system' });
    h = commit(h, { id: 'v2', label: 'Auto Edit', author: 'ai' });
    h = commit(h, { id: 'v3', label: 'More Dynamic', author: 'ai' });
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(h.head).toBe('v2');
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.head).toBe('v3');
    h = undo(undo(h));
    expect(h.head).toBe('v1');
    expect(canUndo(h)).toBe(false);
    h = commit(h, { id: 'v4', label: 'Bigger Captions', author: 'ai' });
    expect(h.versions.find((v) => v.id === 'v4')!.parentId).toBe('v1');
    h = checkout(h, 'v3');
    expect(h.head).toBe('v3');
    h = undo(h);
    expect(h.head).toBe('v2');
  });
});

describe('slogan and photo commands', () => {
  it('maps the creator request to slogan + photo ops', () => {
    const r = run('Non saltare mai la intro we uaglu cia, deve essere lo slogan del canale. Quando nomina Salvador Danzi fai comparire la foto di Salvador Danzi');
    if (r.kind !== 'ops') throw new Error(r.reply);
    expect(r.ops[0]).toEqual({ op: 'set_slogan', text: 'We uagliù, cià!' });
    expect(r.ops).toContainEqual({ op: 'add_graphic', kind: 'photo', text: 'Salvador Danzi', match: 'Salvador', duration: 2.6 });
  });
  it('slogan is never cut and opens the video', () => {
    const ctx2 = { ...ctx, images: [{ id: 'IMG', name: 'p.jpg' }] };
    const t2 = applyOps(t, [{ op: 'set_slogan', text: 'Ciao ragazzi' }, { op: 'add_graphic', kind: 'photo', text: 'Forno', match: 'forno' }], ctx2).timeline;
    const sl = t2.graphics.find((g) => g.properties.kind === 'slogan')!;
    expect(sl.start).toBeLessThan(0.2);
    expect(t2.clips[0].properties.srcStart).toBeLessThan(0.6);
    const ph = t2.graphics.find((g) => g.properties.kind === 'photo')!;
    expect(ph.properties.mediaId).toBe('IMG');
    expect(t2.audio.some((a) => a.reason.includes('photo'))).toBe(true);
  });
});

describe('patch ops', () => {
  it('update_settings / update_captions only touch the keys they name', () => {
    const t2 = applyOps(t, [{ op: 'set_slogan', text: 'Ciao ragazzi' }, { op: 'update_captions', patch: { fontSize: 96 } }], ctx).timeline;
    const [o1, o2] = OpList.parse([{ op: 'update_settings', patch: { maxPause: 0.3 } }, { op: 'update_captions', patch: { maxWords: 3 } }]);
    expect(Object.keys((o1 as { patch: object }).patch)).toEqual(['maxPause']);
    const t3 = applyOps(t2, [o1, o2], ctx).timeline;
    expect(t3.settings.slogan).toBe('Ciao ragazzi');
    expect(t3.settings.maxPause).toBe(0.3);
    expect(t3.settings.captions.fontSize).toBe(96);
    expect(t3.settings.captions.maxWords).toBe(3);
  });
});

describe('picked moments, gag inserts, detail zooms', () => {
  const t0 = applyOps(t, [{ op: 'set_selects', mediaId: 'A', ranges: [{ start: 4.6, end: 7 }, { start: 14.2, end: 17 }] }], ctx).timeline;
  it('set_selects keeps only the picked ranges, joined by the viral zoom transition', () => {
    const a = t0.clips.filter((c) => c.source === 'A');
    expect(a.map((c) => [c.properties.srcStart, c.properties.srcEnd])).toEqual([[4.6, 7], [14.2, 17]]);
    expect(a.every((c) => c.properties.role === 'select')).toBe(true);
    expect(t0.transitions.some((x) => x.properties.kind === 'zoom' && Math.abs(x.properties.at - a[1].start) < 0.01)).toBe(true);
  });
  it('add_insert splits the host shot and whips in/out; add_source_zoom follows the moment', () => {
    const t1 = applyOps(t0, [
      { op: 'add_insert', mediaId: 'C', srcStart: 1, srcEnd: 2, afterMediaId: 'A', afterSrc: 6 },
      { op: 'add_source_zoom', mediaId: 'A', srcStart: 14.5, srcEnd: 16, scale: 1.3, x: 0.4, y: 0.7 },
    ], ctx).timeline;
    const i = t1.clips.findIndex((c) => c.properties.role === 'insert');
    expect(t1.clips[i - 1].properties.srcEnd).toBe(6);
    expect(t1.clips[i + 1].properties).toMatchObject({ srcStart: 6, srcEnd: 7 });
    expect(t1.transitions.filter((x) => x.properties.kind === 'whip').length).toBeGreaterThanOrEqual(2);
    const z = t1.zoom.find((x) => x.properties.x === 0.4)!;
    const host = t1.clips.find((c) => c.source === 'A' && c.properties.srcStart === 14.2)!;
    expect(z.start).toBeCloseTo(host.start + 0.3, 2);
    expect(z.properties.to).toBe(1.3);
  });
  it('keep_source brings back a cut passage', () => {
    const cut = applyOps(t, [{ op: 'remove_range', start: 0, end: 5 }], ctx).timeline;
    const back = applyOps(cut, [{ op: 'keep_source', mediaId: 'A', start: 0.5, end: 2.6 }], ctx).timeline;
    expect(back.clips.some((c) => c.source === 'A' && c.properties.srcStart <= 0.6)).toBe(true);
  });
});

describe('gag insert before the intro', () => {
  it('anchored at the start of a clip, the insert opens the video', () => {
    const t1 = applyOps(t, [{ op: 'add_insert', mediaId: 'C', srcStart: 1, srcEnd: 2, afterMediaId: 'A', afterSrc: 0 }], ctx).timeline;
    expect(t1.clips[0].properties.role).toBe('insert');
    expect(t1.clips[0].properties.volume).toBeLessThan(1);
    const t2 = applyOps(t1, [{ op: 'remove_inserts' }], ctx).timeline;
    expect(t2.clips.some((c) => c.properties.role === 'insert')).toBe(false);
  });
});
