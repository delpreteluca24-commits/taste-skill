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
