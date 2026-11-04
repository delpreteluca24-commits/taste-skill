import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { api, type Job, type RenderRecord } from '../api';
import { Button, Progress } from './ui';

export const ExportDialog: React.FC<{ projectId: string; renders: RenderRecord[]; job: Job | null; allow4k: boolean; onClose: () => void; onChange: () => void }> = ({ projectId, renders, job, allow4k, onClose, onChange }) => {
  const [res, setRes] = useState<'720' | '1080' | '2160'>('1080');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const running = job && (job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    if (!running) return;
    const t = setInterval(onChange, 1500);
    return () => clearInterval(t);
  }, [running, onChange]);

  const start = async () => {
    setError('');
    try {
      const r = await api.render(projectId, res);
      setWarnings(r.warnings ?? []);
      onChange();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Esporta MP4</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded hover:bg-ink-800" aria-label="Chiudi"><X size={14} /></button>
        </div>
        <p className="mt-1 text-xs text-ink-400">H.264 · AAC · 30 fps · loudness -14 LUFS · QC automatico prima del rendering.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {([['720', '720×1280', 'bozza veloce'], ['1080', '1080×1920', 'consigliato'], ['2160', '2160×3840', allow4k ? '4K' : 'serve sorgente 4K']] as const).map(([k, label, hint]) => (
            <button key={k} disabled={k === '2160' && !allow4k} onClick={() => setRes(k)}
              className={`rounded-xl border p-3 text-left disabled:opacity-40 ${res === k ? 'border-accent bg-accent/10' : 'border-ink-700 hover:border-ink-500'}`}>
              <div className="font-mono text-sm">{label}</div>
              <div className="text-[11px] text-ink-400">{hint}</div>
            </button>
          ))}
        </div>
        {running ? (
          <div className="mt-5 space-y-2">
            <Progress value={job!.progress} />
            <p className="text-xs text-ink-300">{job!.step}</p>
          </div>
        ) : (
          <Button variant="primary" className="mt-5 w-full" onClick={start}>Avvia export</Button>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {warnings.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-amber-300">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        {renders.length > 0 && (
          <div className="mt-5 border-t border-ink-800 pt-3">
            <h3 className="text-xs text-ink-400">Export recenti</h3>
            <ul className="mt-2 space-y-1.5">
              {renders.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink-300">{r.resolution}p · {new Date(r.createdAt).toLocaleTimeString('it-IT')}{r.sizeBytes ? ` · ${(r.sizeBytes / 1e6).toFixed(1)} MB` : ''}{r.renderMs ? ` · ${(r.renderMs / 1000).toFixed(0)}s` : ''}</span>
                  {r.status === 'done' ? (
                    <a className="inline-flex items-center gap-1 text-accent hover:underline" href={`/api/projects/${projectId}/renders/${r.id}/file`}><Download size={13} /> Scarica</a>
                  ) : (
                    <span className={`text-xs ${r.status === 'error' ? 'text-red-300' : 'text-ink-400'}`} title={r.error}>{r.status === 'error' ? 'errore' : r.status}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
