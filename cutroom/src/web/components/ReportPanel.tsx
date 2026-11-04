import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { Report } from '../api';
import { scoreTone } from './ui';

const toneBar = { good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-400' };

/** Content Retention Score (observable signals) + VIDEO_QC. Never a virality promise. */
export const ReportPanel: React.FC<{ report: Report; onSeek: (t: number) => void; onClose: () => void }> = ({ report, onSeek, onClose }) => (
  <div className="absolute right-3 top-14 z-40 w-[380px] rounded-2xl border border-ink-700 bg-ink-900 p-4 shadow-2xl">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-xs text-ink-400">Content Retention Score</div>
        <div className="mt-0.5 text-3xl font-semibold tabular">{report.retention.score}<span className="text-base text-ink-400">/100</span></div>
        <p className="mt-1 text-[11px] leading-snug text-ink-500">Basato su segnali osservabili del montaggio. Non è una previsione di views.</p>
      </div>
      <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded hover:bg-ink-800" aria-label="Chiudi"><X size={14} /></button>
    </div>
    <div className="mt-3 space-y-2">
      {report.retention.signals.map((s) => (
        <div key={s.key}>
          <div className="flex justify-between text-xs"><span className="text-ink-300">{s.label}</span><span className="text-ink-400">{s.detail}</span></div>
          <div className="mt-1 h-1 rounded-full bg-ink-800"><div className={`h-full rounded-full ${toneBar[scoreTone(s.score)]}`} style={{ width: `${s.score}%` }} /></div>
        </div>
      ))}
    </div>
    {report.retention.suggestions.length > 0 && (
      <div className="mt-4">
        <div className="text-xs font-medium text-ink-300">Suggerimenti</div>
        <ul className="mt-1.5 space-y-1">
          {report.retention.suggestions.map((s, i) => (
            <li key={i}>
              <button disabled={s.at === undefined} onClick={() => s.at !== undefined && onSeek(s.at)} className="text-left text-xs text-ink-300 enabled:hover:text-accent">• {s.text}</button>
            </li>
          ))}
        </ul>
      </div>
    )}
    <div className="mt-4">
      <div className="text-xs font-medium text-ink-300">Quality control</div>
      {report.qc.length === 0 && <p className="mt-1 text-xs text-emerald-300">Nessun problema rilevato.</p>}
      <ul className="mt-1.5 space-y-1">
        {report.qc.map((q, i) => (
          <li key={i} className="flex gap-1.5 text-xs text-ink-300">
            {q.fixed ? <CheckCircle2 size={13} className="mt-px shrink-0 text-emerald-400" /> : q.severity === 'info' ? <Info size={13} className="mt-px shrink-0 text-ink-400" /> : <AlertTriangle size={13} className="mt-px shrink-0 text-amber-400" />}
            <span>{q.message}{q.fixed ? ' (corretto in export)' : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);
