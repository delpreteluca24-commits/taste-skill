import path from 'node:path';
import fs from 'node:fs/promises';
import { store, newId, type ChatMessage, type Project, type Proposal, type RenderRecord } from './store';
import { analyzeProject, buildContext, masterPath } from './analyze';
import { enqueue, activeJob } from './jobs';
import { renderTimeline, RESOLUTIONS } from './render';
import { config } from './config';
import { applyOps, autoEdit, originalTimeline, rebuild } from '../core/engine';
import { interpret, type ChatContext, type Intent } from '../core/interpreter';
import { canRedo, canUndo, checkout, commit, getVersion, redo, undo } from '../core/history';
import { describeAutoEdit, describeChange } from '../core/diff';
import { runQc } from '../core/agents/qc';
import { retentionReport } from '../core/agents/score';
import type { MediaAsset, PresetId, Timeline } from '../core/timeline';
import type { Op } from '../core/ops';
import { PRESET_LABELS } from '../core/presets';
import { interpretWithClaude, llmEnabled } from './llm/claude';

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function must(id: string): Promise<Project> {
  const p = await store.get(id);
  if (!p) throw new HttpError(404, 'Progetto non trovato');
  return p;
}

export async function headTimeline(p: Project): Promise<Timeline | null> {
  return p.history.head ? store.getVersion(p.id, p.history.head) : null;
}

export async function projectView(id: string) {
  const p = await must(id);
  const timeline = await headTimeline(p);
  const analyses: Record<string, unknown> = {};
  const ctx = await buildContext(p);
  for (const m of p.media) {
    const a = ctx.analyses[m.id];
    if (a) analyses[m.id] = {
      kind: a.kind, orientation: a.orientation, speechRatio: a.speechRatio, hookScore: a.hookScore, retentionScore: a.retentionScore,
      clarityScore: a.clarityScore, transcript: a.raw.transcript?.text ?? '', words: a.raw.transcript?.words.length ?? 0,
      dropped: a.raw.transcript?.words.filter((w) => w.flags.includes('hallucination')).length ?? 0, model: a.raw.transcript?.model ?? null,
      sentences: a.sentences.map((s) => ({ id: s.id, text: s.text, role: s.role, start: s.start, end: s.end })),
      silences: a.raw.silences.length, scenes: a.raw.scenes.length, faces: a.raw.faces.filter((f) => f.boxes.length).length / Math.max(1, a.raw.faces.length),
      loudness: a.raw.loudness,
    };
  }
  return {
    project: p,
    timeline,
    analyses,
    canUndo: canUndo(p.history),
    canRedo: canRedo(p.history),
    jobs: { analyze: activeJob(id, 'analyze'), render: activeJob(id, 'render') },
    chat: await store.getChat(id),
    renders: await store.getRenders(id),
    engine: llmEnabled() ? 'claude' : 'rules',
  };
}

// ───────── media ─────────

export async function addMedia(id: string, files: { filename: string; tmp: string; size: number }[]) {
  return store.withLock(id, async () => {
    const p = await must(id);
    let pos = p.media.reduce((a, m) => Math.max(a, m.position + 1), 0);
    for (const f of files) {
      const kind: MediaAsset['kind'] = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.filename) ? 'audio' : 'video';
      const m: MediaAsset = { id: newId(), filename: f.filename, kind, position: pos++, size: f.size, status: 'uploaded' };
      const dest = store.mediaDir(id, m.id);
      await fs.mkdir(dest, { recursive: true });
      await fs.rename(f.tmp, path.join(dest, 'original' + (f.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? '.mp4')));
      p.media.push(m);
    }
    if (p.status === 'ready') p.status = 'new';
    return store.save(p);
  });
}

export async function reorderMedia(id: string, order: string[]) {
  const p = await store.withLock(id, async () => {
    const p = await must(id);
    const pos = new Map(order.map((m, i) => [m, i]));
    p.media = p.media.map((m) => ({ ...m, position: pos.get(m.id) ?? m.position + order.length })).sort((a, b) => a.position - b.position);
    return store.save(p);
  });
  // Narrative order changed → rebuild the cut on top of the current version (user edits are kept).
  if (p.history.head) await commitRebuild(id, 'Ordine clip aggiornato');
  return p;
}

export async function removeMedia(id: string, mediaId: string) {
  const p = await store.withLock(id, async () => {
    const p = await must(id);
    p.media = p.media.filter((m) => m.id !== mediaId);
    await fs.rm(store.mediaDir(id, mediaId), { recursive: true, force: true });
    return store.save(p);
  });
  if (p.history.head) await commitRebuild(id, 'Clip rimossa');
  return p;
}

async function commitRebuild(id: string, label: string) {
  const p = await must(id);
  const head = await headTimeline(p);
  if (!head) return;
  const ctx = await buildContext(p);
  if (!ctx.order.length) return;
  const t = rebuild(head, ctx, ['clips']);
  await commitVersion(id, t, label, 'system', describeChange(head, t));
}

// ───────── analysis & auto edit ─────────

export async function startAnalysis(id: string, preset?: PresetId) {
  const p = await must(id);
  const videos = p.media.filter((m) => m.kind === 'video');
  if (videos.length < 1) throw new HttpError(400, 'Carica almeno un video');
  const existing = activeJob(id, 'analyze');
  if (existing) return existing;
  await store.withLock(id, async () => {
    const q = await must(id);
    q.status = 'analyzing';
    q.error = undefined;
    if (preset) q.preset = preset;
    await store.save(q);
  });
  return enqueue('analyze', id, async (job) => {
    await analyzeProject(id, job);
    job.step = 'Montaggio automatico';
    await runAutoEdit(id, preset ?? p.preset);
    await store.withLock(id, async () => {
      const q = await must(id);
      q.status = 'ready';
      await store.save(q);
    });
  });
}

export async function commitVersion(id: string, t: Timeline, label: string, author: 'ai' | 'user' | 'system', summary?: string, ops?: Op[]) {
  return store.withLock(id, async () => {
    const p = await must(id);
    const vid = newId();
    await store.saveVersion(id, vid, t);
    p.history = commit(p.history, { id: vid, label, author, summary, ops });
    await store.save(p);
    return { project: p, versionId: vid };
  });
}

export async function runAutoEdit(id: string, preset: PresetId) {
  const p = await must(id);
  const ctx = await buildContext(p);
  if (!ctx.order.length) throw new HttpError(400, 'Nessun video analizzato');
  if (!p.history.versions.length) await commitVersion(id, originalTimeline(ctx), 'Originale', 'system', 'Clip complete in ordine di caricamento.');
  const cur = await must(id);
  const base = await headTimeline(cur);
  const isOriginal = getVersion(cur.history, cur.history.head)?.label === 'Originale';
  // On an existing edit a preset change is an incremental op (user cuts, locked elements, caption fixes survive).
  const t = base && !isOriginal ? applyOps(base, [{ op: 'apply_preset', preset }], ctx).timeline : autoEdit(ctx, preset);
  const summary = describeAutoEdit(t);
  await store.withLock(id, async () => { const q = await must(id); q.preset = preset; await store.save(q); });
  const r = await commitVersion(id, t, `Auto Edit (${PRESET_LABELS[preset]})`, 'ai', summary, [{ op: 'apply_preset', preset }]);
  await appendChat(id, { role: 'assistant', text: summary, status: 'applied', versionId: r.versionId, engine: 'rules' });
  return r;
}

// ───────── history ─────────

export async function historyAction(id: string, action: 'undo' | 'redo' | { checkout: string }) {
  return store.withLock(id, async () => {
    const p = await must(id);
    p.history = action === 'undo' ? undo(p.history) : action === 'redo' ? redo(p.history) : checkout(p.history, action.checkout);
    return store.save(p);
  });
}

// ───────── chat ─────────

async function appendChat(id: string, m: Omit<ChatMessage, 'id' | 'createdAt'>) {
  return store.withLock(id, async () => {
    const msgs = await store.getChat(id);
    const msg: ChatMessage = { ...m, id: newId(), createdAt: new Date().toISOString() };
    msgs.push(msg);
    await store.saveChat(id, msgs.slice(-300));
    return msg;
  });
}

async function updateChat(id: string, proposalId: string, patch: Partial<ChatMessage>) {
  await store.withLock(id, async () => {
    const msgs = await store.getChat(id);
    await store.saveChat(id, msgs.map((m) => (m.proposalId === proposalId ? { ...m, ...patch } : m)));
  });
}

async function understand(message: string, t: Timeline, cctx: ChatContext): Promise<{ intent: Intent; engine: 'claude' | 'rules' }> {
  if (llmEnabled()) {
    try {
      return { intent: await interpretWithClaude(message, t, cctx), engine: 'claude' };
    } catch (e) {
      console.warn('[chat] Claude unavailable, falling back to rules:', (e as Error).message);
    }
  }
  return { intent: interpret(message, t, cctx), engine: 'rules' };
}

const labelFor = (ops: Op[]) => {
  const o = ops[0];
  const map: Partial<Record<Op['op'], string>> = {
    remove_range: 'Taglio', set_max_duration: 'Durata massima', pacing: 'Più dinamico', zoom_amount: 'Zoom', sfx_amount: 'SFX',
    graphics_amount: 'Grafiche', remove_effects: 'Senza effetti', add_graphic: 'Grafica', add_cta: 'CTA finale', add_sfx: 'SFX',
    add_zoom: 'Zoom', strengthen_hook: 'Hook più forte', update_captions: 'Sottotitoli', update_settings: 'Impostazioni', variation: 'Variante',
    delete_elements: 'Elemento rimosso', restore_cuts: 'Tagli ripristinati',
  };
  if (o.op === 'apply_preset') return `Stile ${PRESET_LABELS[o.preset]}`;
  if (o.op === 'pacing' && o.direction === 'slower') return 'Più calmo';
  return map[o.op] ?? 'Modifica';
};

/** USER_INTENT → TIMELINE_OPERATION → VALIDATION (QC) → PREVIEW (proposal). Nothing is committed until Apply. */
export async function chat(id: string, message: string, cctx: ChatContext) {
  const p = await must(id);
  const head = await headTimeline(p);
  await appendChat(id, { role: 'user', text: message });
  if (!head) {
    const msg = await appendChat(id, { role: 'assistant', text: 'Carica e analizza i video prima di modificarli.', status: 'info' });
    return { message: msg };
  }
  const { intent, engine } = await understand(message, head, cctx);
  if (intent.kind === 'history') {
    if (intent.action === 'undo' ? !canUndo(p.history) : !canRedo(p.history)) {
      return { message: await appendChat(id, { role: 'assistant', text: intent.action === 'undo' ? 'Sei già alla prima versione.' : 'Non c\'è nulla da ripristinare.', status: 'info', engine }) };
    }
    await historyAction(id, intent.action);
    return { message: await appendChat(id, { role: 'assistant', text: intent.reply, status: 'info', engine }), history: intent.action };
  }
  if (intent.kind === 'export') return { message: await appendChat(id, { role: 'assistant', text: intent.reply, status: 'info', engine }), export: true };
  if (intent.kind === 'unknown') return { message: await appendChat(id, { role: 'assistant', text: intent.reply, status: 'info', engine }) };
  return propose(id, p, head, message, intent.ops, intent.reply, engine, 0);
}

async function propose(id: string, p: Project, head: Timeline, message: string, ops: Op[], reply: string, engine: 'claude' | 'rules', variant: number) {
  const ctx = await buildContext(p);
  const variantOps: Op[] = variant > 0 ? [...ops, ...Array.from({ length: variant }, () => ({ op: 'variation' }) as Op)] : ops;
  const { timeline, notes } = applyOps(head, variantOps, ctx);
  const qc = runQc(timeline, ctx);
  const summary = describeChange(head, qc.timeline);
  const fixed = qc.issues.filter((i) => i.fixed && i.severity !== 'info').map((i) => i.message);
  const text = [reply, summary, ...notes, ...(fixed.length ? [`QC: ${fixed.join(' ')}`] : [])].join(' ');
  const proposal: Proposal = {
    id: newId(), baseVersionId: p.history.head!, message, ops, reply, summary: text, label: labelFor(ops), variant, engine, timeline: qc.timeline,
  };
  await store.saveProposal(id, proposal);
  const msg = await appendChat(id, { role: 'assistant', text, status: 'proposed', proposalId: proposal.id, ops: variantOps, engine });
  return { message: msg, proposal: { id: proposal.id, timeline: proposal.timeline, summary: text } };
}

export async function applyProposal(id: string, pid: string) {
  const pr = await store.getProposal(id, pid);
  if (!pr) throw new HttpError(404, 'Proposta non trovata');
  const p = await must(id);
  if (p.history.head !== pr.baseVersionId) {
    // The edit moved on since the proposal: re-apply the same ops on the current head (still incremental).
    const head = await headTimeline(p);
    const ctx = await buildContext(p);
    const { timeline } = applyOps(head!, pr.ops, ctx);
    pr.timeline = runQc(timeline, ctx).timeline;
  }
  const r = await commitVersion(id, pr.timeline, pr.label, 'ai', pr.summary, pr.ops);
  await updateChat(id, pid, { status: 'applied', versionId: r.versionId });
  return r;
}

export async function discardProposal(id: string, pid: string) {
  await updateChat(id, pid, { status: 'discarded' });
  return { ok: true };
}

export async function retryProposal(id: string, pid: string) {
  const pr = await store.getProposal(id, pid);
  if (!pr) throw new HttpError(404, 'Proposta non trovata');
  await updateChat(id, pid, { status: 'discarded' });
  const p = await must(id);
  const base = await store.getVersion(id, pr.baseVersionId) ?? (await headTimeline(p))!;
  return propose(id, p, base, pr.message, pr.ops, 'Ecco un\'altra versione.', pr.engine, pr.variant + 1);
}

/** Fine tune from the UI (inspector / timeline): same ops, committed immediately as a user version. */
export async function applyUserOps(id: string, ops: Op[], label = 'Modifica manuale') {
  const p = await must(id);
  const head = await headTimeline(p);
  if (!head) throw new HttpError(400, 'Nessuna timeline');
  const ctx = await buildContext(p);
  const { timeline, notes } = applyOps(head, ops, ctx);
  const r = await commitVersion(id, timeline, label, 'user', describeChange(head, timeline), ops);
  return { ...r, notes };
}

export async function report(id: string) {
  const p = await must(id);
  const head = await headTimeline(p);
  if (!head) throw new HttpError(400, 'Nessuna timeline');
  const ctx = await buildContext(p);
  const qc = runQc(head, ctx);
  return { retention: retentionReport(qc.timeline, ctx), qc: qc.issues };
}

// ───────── render ─────────

export async function startRender(id: string, resolution: keyof typeof RESOLUTIONS, baseUrl: string) {
  const p = await must(id);
  const head = await headTimeline(p);
  if (!head) throw new HttpError(400, 'Nessuna timeline da esportare');
  const existing = activeJob(id, 'render');
  if (existing) return existing;
  const ctx = await buildContext(p);
  const { timeline, issues } = runQc(head, ctx);
  const errors = issues.filter((i) => i.severity === 'error' && !i.fixed);
  if (errors.length) throw new HttpError(400, `QC: ${errors.map((e) => e.message).join(' ')}`);
  const maxSide = Math.max(...p.media.filter((m) => m.kind === 'video').map((m) => Math.max(m.width ?? 0, m.height ?? 0)));
  if (resolution === '2160' && maxSide < 3000) throw new HttpError(400, '4K disponibile solo con sorgenti 4K.');
  const rec: RenderRecord = { id: newId(), versionId: p.history.head!, resolution, status: 'queued', progress: 0, createdAt: new Date().toISOString() };
  await store.withLock(id, async () => { const r = await store.getRenders(id); r.unshift(rec); await store.saveRenders(id, r.slice(0, 20)); });
  const media: Record<string, { src: string; voiceSrc?: string; width: number; height: number }> = {};
  for (const m of p.media.filter((x) => x.status === 'ready')) {
    const a = ctx.analyses[m.id];
    media[m.id] = { src: `${baseUrl}/files/${id}/${m.id}/${path.basename(masterPath(p, m))}`, voiceSrc: m.voice ? `${baseUrl}/files/${id}/${m.id}/voice.wav` : undefined, width: a?.raw.width ?? m.width ?? 1080, height: a?.raw.height ?? m.height ?? 1920 };
  }
  const setRec = (patch: Partial<RenderRecord>) => store.withLock(id, async () => {
    const r = await store.getRenders(id);
    await store.saveRenders(id, r.map((x) => (x.id === rec.id ? { ...x, ...patch } : x)));
  });
  const job = enqueue('render', id, async (j) => {
    await setRec({ status: 'rendering' });
    const file = store.dir(id, 'renders', `${rec.id}.mp4`);
    try {
      const { renderMs } = await renderTimeline({ timeline, media, assetBase: `${baseUrl}/assets`, resolution, output: file, job: j });
      const st = await fs.stat(file);
      await setRec({ status: 'done', progress: 1, file: `${rec.id}.mp4`, renderMs, sizeBytes: st.size });
      return { renderId: rec.id };
    } catch (e: any) {
      await setRec({ status: 'error', error: String(e?.message ?? e) });
      throw e;
    }
  });
  return { ...job, renderId: rec.id, warnings: issues.filter((i) => !i.fixed && i.severity === 'warning').map((i) => i.message) };
}

export const renderFile = (id: string, rid: string) => store.dir(id, 'renders', `${rid}.mp4`);
export { getVersion, config };
