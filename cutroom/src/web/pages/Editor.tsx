import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { ArrowDown, ArrowUp, ChevronDown, Download, Film, Gauge, History, Music, Pause, Play, Plus, Redo2, Undo2, X } from 'lucide-react';
import { api, fmtTime, type ProjectView, type Report } from '../api';
import { Button, Pill, Progress, SectionTitle, scoreTone } from '../components/ui';
import { Timeline } from '../components/Timeline';
import { ChatPanel } from '../components/ChatPanel';
import { Inspector } from '../components/Inspector';
import { ExportDialog } from '../components/ExportDialog';
import { ReportPanel } from '../components/ReportPanel';
import { ShortVideo } from '../../remotion/ShortVideo';
import { PRESETS, PRESET_LABELS } from '../../core/presets';
import { findElement } from '../../core/engine';
import type { AnyElement, PresetId, Timeline as TL } from '../../core/timeline';
import type { Op } from '../../core/ops';
import { navigate } from '../nav';

const STEPS = ['Upload', 'Analisi', 'AI Edit', 'Preview', 'Chat', 'Fine tune', 'Export'];

export const Editor: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [view, setView] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [proposal, setProposal] = useState<{ id: string; timeline: TL; summary: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [leftTab, setLeftTab] = useState<'clips' | 'analysis'>('clips');
  const player = useRef<PlayerRef>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setView(await api.view(projectId)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // Restore a pending proposal after a reload: the latest assistant message is still actionable.
  const restored = useRef(false);
  useEffect(() => {
    if (!view || restored.current) return;
    restored.current = true;
    const last = [...view.chat].reverse().find((m) => m.role === 'assistant');
    if (last?.status === 'proposed' && last.proposalId) api.getProposal(projectId, last.proposalId).then(setProposal).catch(() => undefined);
  }, [view, projectId]);

  const analyzing = view?.project.status === 'analyzing' || !!view?.jobs.analyze;
  useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [analyzing, load]);

  const timeline = proposal?.timeline ?? view?.timeline ?? null;
  const fps = timeline?.fps ?? 30;
  const time = frame / fps;
  const refreshReport = useCallback(() => { if (view?.timeline) api.report(projectId).then(setReport).catch(() => undefined); }, [projectId, view?.timeline]);
  useEffect(() => { refreshReport(); }, [refreshReport]);

  // Player events
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, [timeline !== null]);

  const seek = (t: number) => { const f = Math.max(0, Math.round(t * fps)); player.current?.seekTo(f); setFrame(f); };

  const media = useMemo(() => {
    const out: Record<string, { src: string; voiceSrc?: string; width: number; height: number }> = {};
    for (const m of view?.project.media ?? []) {
      if (m.status !== 'ready') continue;
      const ext = m.filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.jpg';
      out[m.id] = { src: `/files/${projectId}/${m.id}/${m.kind === 'audio' ? 'music.m4a' : m.kind === 'image' ? `original${ext}` : 'preview.mp4'}`, voiceSrc: m.voice ? `/files/${projectId}/${m.id}/voice.wav` : undefined, width: m.width ?? 1080, height: m.height ?? 1920 };
    }
    return out;
  }, [view?.project.media, projectId]);

  const names = useMemo(() => Object.fromEntries((view?.project.media ?? []).map((m) => [m.id, `${m.position + 1}. ${m.filename.replace(/\.[^.]+$/, '')}`])), [view?.project.media]);
  const order = useMemo(() => (view?.project.media ?? []).filter((m) => m.kind === 'video').sort((a, b) => a.position - b.position).map((m) => m.id), [view?.project.media]);
  const selectedEl = timeline && selectedId ? findElement(timeline, selectedId)?.el ?? null : null;

  const doOps = async (ops: Op[], label: string) => {
    setBusy(true);
    try { await api.ops(projectId, ops, label); setSelectedId(null); setProposal(null); await load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const send = async (text: string) => {
    setBusy(true);
    try {
      const r = await api.chat(projectId, text, time, selection);
      if (r.proposal) setProposal(r.proposal);
      if (r.export) setShowExport(true);
      await load();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const onProposal = async (pid: string, action: 'apply' | 'discard' | 'retry') => {
    setBusy(true);
    try {
      const r = await api.proposal(projectId, pid, action);
      setProposal(action === 'retry' && r.proposal ? r.proposal : null);
      if (action === 'apply') setSelection(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const history = async (fn: () => Promise<unknown>) => { setProposal(null); await fn(); await load(); };

  // Keyboard: space = play/pause, delete = remove selected element.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); player.current?.toggle(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl && selectedEl.type !== 'subtitle' && selectedEl.type !== 'music') doOps([{ op: 'delete_elements', ids: [selectedEl.id] }], 'Elemento rimosso');
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); history(() => (e.shiftKey ? api.redo(projectId) : api.undo(projectId))); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { await api.upload(projectId, [...files]); await api.analyze(projectId); await load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const move = async (id: string, d: number) => {
    const ids = [...(view?.project.media ?? [])].sort((a, b) => a.position - b.position).map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setProposal(null);
    await api.reorder(projectId, ids);
    await load();
  };

  if (!view) return <div className="grid h-full place-items-center text-sm text-ink-400">{error || 'Caricamento…'}</div>;
  const p = view.project;
  const head = p.history.versions.find((v) => v.id === p.history.head);
  const step = !timeline ? (analyzing ? 1 : 0) : view.renders.some((r) => r.status === 'done') ? 6 : view.chat.some((m) => m.role === 'user') ? 5 : 3;

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-ink-800 px-3">
        <button onClick={() => navigate('/')} className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink" aria-label="Progetti"><Film size={14} strokeWidth={2.5} /></button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.name}</div>
        </div>
        <ol className="ml-2 hidden items-center gap-1 text-[11px] xl:flex">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-md px-1.5 py-0.5 ${i === step ? 'bg-accent/15 text-accent' : i < step ? 'text-ink-300' : 'text-ink-500'}`}>{i + 1}. {s}</li>
          ))}
        </ol>
        <div className="ml-auto flex items-center gap-2">
          {timeline && (
            <>
              <select value={p.preset} disabled={busy}
                onChange={async (e) => { setBusy(true); setProposal(null); await api.autoEdit(projectId, e.target.value as PresetId); await load(); setBusy(false); }}
                className="h-8 rounded-lg border border-ink-700 bg-ink-850 px-2 text-xs outline-none" title="Rigenera il montaggio con un preset (le tue modifiche restano)">
                {PRESETS.map((x) => <option key={x} value={x}>{PRESET_LABELS[x]}</option>)}
              </select>
              <Button size="sm" variant="ghost" disabled={!view.canUndo || busy} onClick={() => history(() => api.undo(projectId))} title="Annulla (Ctrl+Z)"><Undo2 size={14} /></Button>
              <Button size="sm" variant="ghost" disabled={!view.canRedo || busy} onClick={() => history(() => api.redo(projectId))} title="Ripristina (Ctrl+Shift+Z)"><Redo2 size={14} /></Button>
              <div className="relative">
                <Button size="sm" onClick={() => setShowVersions(!showVersions)}><History size={13} /> v{head?.n} <ChevronDown size={12} /></Button>
                {showVersions && (
                  <div className="absolute right-0 top-9 z-40 max-h-96 w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-1 shadow-2xl scroll-thin">
                    {[...p.history.versions].reverse().map((v) => (
                      <button key={v.id} onClick={() => { setShowVersions(false); history(() => api.checkout(projectId, v.id)); }}
                        className={`block w-full rounded-lg px-2.5 py-2 text-left hover:bg-ink-800 ${v.id === p.history.head ? 'bg-ink-800' : ''}`}>
                        <div className="flex items-center justify-between text-sm"><span>Version {v.n} · {v.label}</span>{v.id === p.history.head && <Pill tone="accent">attiva</Pill>}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">{v.author === 'ai' ? 'AI' : v.author === 'user' ? 'Tu' : 'Sistema'} · {new Date(v.createdAt).toLocaleTimeString('it-IT')}{v.summary ? ` · ${v.summary}` : ''}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {report && (
                <Button size="sm" onClick={() => { refreshReport(); setShowReport(!showReport); }} title="Content Retention Score e QC">
                  <Gauge size={13} /> <span className={`tabular ${{ good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-red-300' }[scoreTone(report.retention.score)]}`}>{report.retention.score}</span>
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setShowExport(true)}><Download size={13} /> Esporta</Button>
            </>
          )}
        </div>
        {showReport && report && <ReportPanel report={report} onSeek={seek} onClose={() => setShowReport(false)} />}
      </header>

      {error && <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-200">{error}<button onClick={() => setError('')}><X size={12} /></button></div>}

      {!timeline ? (
        <AnalysisView view={view} onRetry={async () => { await api.analyze(projectId); await load(); }} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[264px_1fr_372px] grid-rows-[1fr_232px]">
          {/* LEFT: media */}
          <aside className="row-span-1 min-h-0 overflow-y-auto border-r border-ink-800 scroll-thin">
            <div className="flex gap-1 border-b border-ink-800 p-2">
              {(['clips', 'analysis'] as const).map((t) => (
                <button key={t} onClick={() => setLeftTab(t)} className={`flex-1 rounded-md py-1 text-xs ${leftTab === t ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200'}`}>{t === 'clips' ? 'Clip' : 'Analisi'}</button>
              ))}
            </div>
            {leftTab === 'clips' ? (
              <>
                <SectionTitle right={<Button size="sm" variant="ghost" onClick={() => addInput.current?.click()} disabled={busy}><Plus size={12} /> Aggiungi</Button>}>Ordine narrativo</SectionTitle>
                <input ref={addInput} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
                <ul className="space-y-1 px-2 pb-3">
                  {[...p.media].sort((a, b) => a.position - b.position).map((m) => {
                    const a = view.analyses[m.id];
                    const used = timeline.clips.filter((c) => c.source === m.id).reduce((acc, c) => acc + c.end - c.start, 0);
                    return (
                      <li key={m.id} className="group rounded-lg border border-ink-800 bg-ink-900 p-2">
                        <div className="flex items-center gap-2">
                          {m.kind === 'audio' ? <Music size={13} className="text-ink-400" /> : <span className="grid h-5 w-5 place-items-center rounded bg-ink-700 font-mono text-[10px]">{m.position + 1}</span>}
                          <span className="min-w-0 flex-1 truncate text-xs" title={m.filename}>{m.filename}</span>
                          <div className="flex opacity-0 group-hover:opacity-100">
                            <button className="grid h-5 w-5 place-items-center rounded hover:bg-ink-700" onClick={() => move(m.id, -1)} aria-label="Su"><ArrowUp size={11} /></button>
                            <button className="grid h-5 w-5 place-items-center rounded hover:bg-ink-700" onClick={() => move(m.id, 1)} aria-label="Giù"><ArrowDown size={11} /></button>
                            <button className="grid h-5 w-5 place-items-center rounded hover:bg-ink-700" onClick={async () => { if (confirm('Rimuovere la clip dal progetto?')) { await api.removeMedia(projectId, m.id); await load(); } }} aria-label="Rimuovi"><X size={11} /></button>
                          </div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {m.status !== 'ready' && <Pill tone={m.status === 'error' ? 'bad' : 'muted'}>{m.status}</Pill>}
                          {a && <Pill tone={a.kind === 'aroll' ? 'accent' : 'muted'}>{a.kind === 'aroll' ? 'parlato' : 'b-roll'}</Pill>}
                          {m.duration && <span className="font-mono text-[10px] text-ink-400">{m.duration.toFixed(1)}s → {used.toFixed(1)}s</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <SectionTitle>Montaggio</SectionTitle>
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 px-3 pb-4 text-xs">
                  <dt className="text-ink-400">Durata</dt><dd className="text-right font-mono">{timeline.duration.toFixed(1)}s</dd>
                  <dt className="text-ink-400">Inquadrature</dt><dd className="text-right font-mono">{timeline.clips.length}</dd>
                  <dt className="text-ink-400">Tagli</dt><dd className="text-right font-mono">{timeline.cuts.length}</dd>
                  <dt className="text-ink-400">Sottotitoli</dt><dd className="text-right font-mono">{timeline.subtitles.length}</dd>
                  <dt className="text-ink-400">Zoom / grafiche</dt><dd className="text-right font-mono">{timeline.zoom.length} / {timeline.graphics.length}</dd>
                  <dt className="text-ink-400">SFX</dt><dd className="text-right font-mono">{timeline.audio.length}</dd>
                </dl>
                {timeline.metadata.warnings.map((w) => <p key={w} className="mx-3 mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{w}</p>)}
              </>
            ) : (
              <div className="space-y-3 p-3">
                {[...p.media].filter((m) => view.analyses[m.id]).sort((a, b) => a.position - b.position).map((m) => {
                  const a = view.analyses[m.id];
                  return (
                    <div key={m.id} className="rounded-lg border border-ink-800 bg-ink-900 p-2.5 text-xs">
                      <div className="truncate font-medium">{m.position + 1}. {m.filename}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Pill tone={scoreTone(a.hookScore * 100)}>hook {Math.round(a.hookScore * 100)}</Pill>
                        <Pill tone={scoreTone(a.retentionScore * 100)}>retention {Math.round(a.retentionScore * 100)}</Pill>
                        <Pill tone={scoreTone(a.clarityScore * 100)}>clarity {Math.round(a.clarityScore * 100)}</Pill>
                      </div>
                      <p className="mt-1.5 text-ink-400">{a.orientation} · parlato {Math.round(a.speechRatio * 100)}% · {a.scenes} cambi scena · volto {Math.round(a.faces * 100)}% · {a.loudness.integrated.toFixed(0)} LUFS</p>
                      <p className="mt-1 text-ink-400">{a.words} parole{a.dropped ? `, ${a.dropped} scartate (rumore/allucinazioni)` : ''} · {a.model ?? 'nessun parlato'}</p>
                      {a.sentences.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {a.sentences.slice(0, 12).map((s) => (
                            <li key={s.id} className="leading-snug text-ink-300"><span className="mr-1 rounded bg-ink-800 px-1 text-[10px] uppercase text-ink-400">{s.role}</span>{s.text}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          {/* CENTER: preview */}
          <section className="relative flex min-h-0 flex-col items-center justify-center gap-3 bg-ink-950 p-4">
            {proposal && (
              <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-accent/40 bg-ink-900/90 px-3 py-1 text-xs text-accent backdrop-blur">Anteprima della modifica proposta</div>
            )}
            <div className="relative h-full max-h-full overflow-hidden rounded-xl border border-ink-800 bg-black" style={{ aspectRatio: '9 / 16' }}>
              <Player
                ref={player}
                component={ShortVideo}
                inputProps={{ timeline: timeline!, media, assetBase: '/assets' }}
                durationInFrames={Math.max(1, Math.round(timeline.duration * fps))}
                compositionWidth={1080}
                compositionHeight={1920}
                fps={fps}
                style={{ width: '100%', height: '100%' }}
                numberOfSharedAudioTags={12}
                clickToPlay
                acknowledgeRemotionLicense
              />
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" onClick={() => seek(Math.max(0, time - 2))}>−2s</Button>
              <Button size="sm" onClick={() => player.current?.toggle()} className="w-20">{playing ? <><Pause size={13} /> Pausa</> : <><Play size={13} /> Play</>}</Button>
              <Button size="sm" variant="ghost" onClick={() => seek(Math.min(timeline.duration, time + 2))}>+2s</Button>
            </div>
          </section>

          {/* RIGHT: inspector + chat */}
          <aside className="row-span-2 flex min-h-0 flex-col border-l border-ink-800">
            {selectedEl && <Inspector el={selectedEl as AnyElement} names={names} onOps={doOps} onClose={() => setSelectedId(null)} />}
            <div className="min-h-0 flex-1">
              <ChatPanel
                messages={view.chat}
                engine={view.engine}
                busy={busy}
                pendingProposalId={proposal?.id ?? null}
                context={selection ? `Contesto: selezione ${selection.start.toFixed(1)}–${selection.end.toFixed(1)}s` : `Contesto: cursore a ${fmtTime(time)} — "questa parte" = inquadratura sotto il cursore`}
                onSend={send}
                onProposal={onProposal}
              />
            </div>
          </aside>

          {/* BOTTOM: timeline */}
          <section className="col-span-2 min-h-0 border-t border-r border-ink-800 bg-ink-900">
            <Timeline
              timeline={timeline}
              time={time}
              order={order}
              names={names}
              selectedId={selectedId}
              selection={selection}
              onSeek={seek}
              onSelectElement={(el) => setSelectedId(el?.id ?? null)}
              onSelection={setSelection}
            />
          </section>
        </div>
      )}
      {showExport && (
        <ExportDialog
          projectId={projectId}
          renders={view.renders}
          job={view.jobs.render}
          allow4k={p.media.some((m) => Math.max(m.width ?? 0, m.height ?? 0) >= 3000)}
          onClose={() => setShowExport(false)}
          onChange={load}
        />
      )}
    </div>
  );
};

const AnalysisView: React.FC<{ view: ProjectView; onRetry: () => void }> = ({ view, onRetry }) => {
  const p = view.project;
  const job = view.jobs.analyze;
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{p.status === 'error' ? 'Analisi interrotta' : 'Analizzo e monto il video'}</h1>
      <p className="mt-1 text-sm text-ink-400">
        Normalizzazione (rotazione, 30 fps, voce), silenzi, scene, volti, trascrizione parola per parola, poi la Edit Decision List e il montaggio automatico.
      </p>
      {job && (
        <div className="mt-6 space-y-2">
          <Progress value={job.progress} />
          <p className="text-sm text-ink-300">{job.step}</p>
        </div>
      )}
      {p.status === 'error' && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {p.error}
          <div className="mt-3"><Button variant="primary" onClick={onRetry}>Riprova l'analisi</Button></div>
        </div>
      )}
      {p.status === 'new' && !job && <Button className="mt-6" variant="primary" onClick={onRetry}>Analizza e monta</Button>}
      <ul className="mt-8 divide-y divide-ink-800 rounded-xl border border-ink-800 bg-ink-900">
        {[...p.media].sort((a, b) => a.position - b.position).map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-5 font-mono text-xs text-ink-400">{m.position + 1}</span>
            <span className="min-w-0 flex-1 truncate">{m.filename}</span>
            <Pill tone={m.status === 'ready' ? 'good' : m.status === 'error' ? 'bad' : m.status === 'processing' ? 'accent' : 'muted'}>
              {m.status === 'ready' ? 'pronto' : m.status === 'processing' ? 'in analisi' : m.status === 'error' ? 'errore' : 'in coda'}
            </Pill>
          </li>
        ))}
      </ul>
    </div>
  );
};
