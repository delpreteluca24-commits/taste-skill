import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Film, Music, Trash2, Upload, X } from 'lucide-react';
import { api, type ProjectSummary } from '../api';
import { Button, Pill, Progress } from '../components/ui';
import { PRESETS, PRESET_LABELS } from '../../core/presets';
import type { PresetId } from '../../core/timeline';
import { navigate } from '../nav';

const PRESET_HINT: Record<PresetId, string> = {
  viral: 'Hook anticipato, ritmo alto, grafiche e SFX',
  premium: 'Pulito, dinamico, effetti misurati',
  minimal: 'Solo tagli e sottotitoli eleganti',
  podcast: 'Pause naturali, karaoke, pochi effetti',
  educational: 'Grafiche esplicative, sottotitoli boxed',
  storytelling: 'Respiro narrativo, look caldo',
  fast: 'Massima velocità, versione aggressiva',
  cinematic: 'Look filmico, movimento lento',
};

const natural = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true });

export const Home: React.FC = () => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<PresetId>('premium');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api.projects().then(setProjects).catch(() => undefined); }, []);

  const add = (list: FileList | null) => {
    if (!list) return;
    const incoming = [...list].filter((f) => /\.(mp4|mov|webm|m4v|mkv|mp3|wav|m4a|aac|jpe?g|png|webp)$/i.test(f.name)).sort(natural);
    setFiles((cur) => [...cur, ...incoming.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size))]);
    if (!name && incoming[0]) setName(incoming[0].name.replace(/\.[^.]+$/, '').slice(0, 40));
  };
  const move = (i: number, d: number) => setFiles((cur) => {
    const n = [...cur];
    const j = i + d;
    if (j < 0 || j >= n.length) return cur;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const videos = files.filter((f) => !/\.(mp3|wav|m4a|aac)$/i.test(f.name));
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api.create(name.trim() || 'Nuovo video');
      await api.upload(p.id, files, setProgress);
      await api.analyze(p.id, preset);
      navigate(`/p/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full">
      <header className="flex h-14 items-center justify-between border-b border-ink-800 px-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink"><Film size={15} strokeWidth={2.5} /></div>
          <span className="font-semibold tracking-tight">Cutroom</span>
          <span className="text-xs text-ink-400">AI social video editor</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Dai video grezzi a uno short 9:16 montato.</h1>
          <p className="mt-2 max-w-xl text-ink-300">
            Carica 2 o più clip nell'ordine del racconto. Cutroom trascrive, taglia pause ed esitazioni, reinquadra sul volto,
            aggiunge sottotitoli, zoom, grafiche e SFX con un motivo preciso. Poi lo rifinisci in chat.
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            className={`mt-6 cursor-pointer rounded-2xl border border-dashed p-8 text-center transition ${drag ? 'border-accent bg-accent/5' : 'border-ink-600 hover:border-ink-500 bg-ink-900'}`}
          >
            <Upload className="mx-auto text-ink-400" size={22} />
            <p className="mt-2 text-sm">Trascina qui i video (MP4, MOV, WEBM) e, se vuoi, una musica</p>
            <p className="text-xs text-ink-400">oppure clicca per scegliere i file</p>
            <input ref={input} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </div>

          {files.length > 0 && (
            <div className="mt-5 rounded-2xl border border-ink-800 bg-ink-900">
              <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5 text-xs text-ink-400">
                <span>Ordine narrativo ({videos.length} video)</span>
                <span>il primo file è l'inizio del racconto</span>
              </div>
              <ol className="divide-y divide-ink-800">
                {files.map((f, i) => (
                  <li key={f.name + f.size} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-right font-mono text-xs text-ink-400">{i + 1}</span>
                    {/\.(mp3|wav|m4a|aac)$/i.test(f.name) ? <Music size={15} className="text-ink-400" /> : <Film size={15} className="text-ink-400" />}
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    <span className="font-mono text-xs text-ink-400">{(f.size / 1e6).toFixed(1)} MB</span>
                    <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Su"><ArrowUp size={13} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="Giù"><ArrowDown size={13} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Rimuovi"><X size={13} /></Button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-6">
            <label className="text-xs text-ink-400">Nome progetto</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Pizza di ottobre" className="mt-1 h-10 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 text-sm outline-none focus:border-ink-500" />
          </div>

          <div className="mt-5">
            <label className="text-xs text-ink-400">Stile di partenza (modificabile dopo)</label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`rounded-xl border p-3 text-left transition ${preset === p ? 'border-accent bg-accent/10' : 'border-ink-700 bg-ink-900 hover:border-ink-500'}`}
                >
                  <div className="text-sm font-medium">{PRESET_LABELS[p]}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-ink-400">{PRESET_HINT[p]}</div>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <div className="mt-6 flex items-center gap-4">
            <Button variant="primary" onClick={start} disabled={busy || videos.length < 1}>
              {busy ? 'Caricamento…' : 'Analizza e monta'}
            </Button>
            {videos.length === 1 && <span className="text-xs text-ink-400">Funziona anche con un solo video; il flusso è pensato per 2+ clip.</span>}
            {busy && <div className="w-48"><Progress value={progress} /></div>}
          </div>
        </section>

        <aside>
          <h2 className="text-sm font-medium text-ink-300">Progetti</h2>
          <div className="mt-3 space-y-2">
            {projects.length === 0 && <p className="text-sm text-ink-400">Nessun progetto ancora.</p>}
            {projects.map((p) => (
              <div key={p.id} className="group flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900 px-4 py-3 hover:border-ink-600">
                <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/p/${p.id}`)}>
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="mt-0.5 text-xs text-ink-400">{p.media} clip · {p.versions} versioni · {new Date(p.updatedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </button>
                <Pill tone={p.status === 'ready' ? 'good' : p.status === 'error' ? 'bad' : 'muted'}>{p.status}</Pill>
                <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100" aria-label="Elimina progetto"
                  onClick={async () => { if (confirm(`Eliminare "${p.name}"?`)) { await api.remove(p.id); setProjects(projects.filter((x) => x.id !== p.id)); } }}>
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
};
