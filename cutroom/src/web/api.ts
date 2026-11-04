import type { MediaAsset, PresetId, Timeline } from '../core/timeline';
import type { History } from '../core/history';
import type { Op } from '../core/ops';

export interface ProjectSummary { id: string; name: string; status: string; updatedAt: string; media: number; versions: number }
export interface Project {
  id: string; name: string; status: 'new' | 'analyzing' | 'ready' | 'error'; error?: string; preset: PresetId;
  media: MediaAsset[]; history: History; createdAt: string; updatedAt: string;
}
export interface Job { id: string; type: string; status: 'queued' | 'running' | 'done' | 'error'; progress: number; step: string; error?: string }
export interface ChatMessage {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: string; proposalId?: string; versionId?: string;
  status?: 'proposed' | 'applied' | 'discarded' | 'info' | 'error'; engine?: 'claude' | 'rules';
}
export interface RenderRecord { id: string; versionId: string; resolution: string; status: string; progress: number; file?: string; error?: string; createdAt: string; renderMs?: number; sizeBytes?: number }
export interface MediaAnalysisView {
  kind: 'aroll' | 'broll'; orientation: string; speechRatio: number; hookScore: number; retentionScore: number; clarityScore: number;
  transcript: string; words: number; dropped: number; model: string | null; silences: number; scenes: number; faces: number;
  sentences: { id: string; text: string; role: string; start: number; end: number }[];
  loudness: { integrated: number; truePeak: number; lra: number };
}
export interface ProjectView {
  project: Project; timeline: Timeline | null; analyses: Record<string, MediaAnalysisView>; canUndo: boolean; canRedo: boolean;
  jobs: { analyze: Job | null; render: Job | null }; chat: ChatMessage[]; renders: RenderRecord[]; engine: 'claude' | 'rules';
}
export interface Report {
  retention: { score: number; signals: { key: string; label: string; score: number; detail: string }[]; suggestions: { at?: number; text: string }[] };
  qc: { code: string; severity: 'error' | 'warning' | 'info'; message: string; at?: number; fixed: boolean }[];
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Errore ${r.status}`);
  return j as T;
}

export const api = {
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  create: (name: string) => req<Project>('POST', '/api/projects', { name }),
  remove: (id: string) => req('DELETE', `/api/projects/${id}`),
  view: (id: string) => req<ProjectView>('GET', `/api/projects/${id}`),
  upload: (id: string, files: File[], onProgress?: (f: number) => void) =>
    new Promise<Project>((resolve, reject) => {
      const fd = new FormData();
      files.forEach((f, i) => fd.append(`file${i}`, f, f.name));
      const x = new XMLHttpRequest();
      x.open('POST', `/api/projects/${id}/media`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        const j = JSON.parse(x.responseText || '{}');
        x.status < 300 ? resolve(j) : reject(new Error(j.error ?? `Upload fallito (${x.status})`));
      };
      x.onerror = () => reject(new Error('Upload fallito'));
      x.send(fd);
    }),
  reorder: (id: string, order: string[]) => req<Project>('PUT', `/api/projects/${id}/media/order`, { order }),
  removeMedia: (id: string, mediaId: string) => req<Project>('DELETE', `/api/projects/${id}/media/${mediaId}`),
  analyze: (id: string, preset?: PresetId) => req<Job>('POST', `/api/projects/${id}/analyze`, { preset }),
  autoEdit: (id: string, preset: PresetId) => req('POST', `/api/projects/${id}/autoedit`, { preset }),
  undo: (id: string) => req('POST', `/api/projects/${id}/undo`),
  redo: (id: string) => req('POST', `/api/projects/${id}/redo`),
  checkout: (id: string, vid: string) => req('POST', `/api/projects/${id}/versions/${vid}/checkout`),
  ops: (id: string, ops: Op[], label?: string) => req<{ notes: string[] }>('POST', `/api/projects/${id}/ops`, { ops, label }),
  chat: (id: string, message: string, playhead: number, selection: { start: number; end: number } | null) =>
    req<{ proposal?: { id: string; timeline: Timeline; summary: string }; history?: string; export?: boolean }>('POST', `/api/projects/${id}/chat`, { message, playhead, selection }),
  getProposal: (id: string, pid: string) => req<{ id: string; timeline: Timeline; summary: string }>('GET', `/api/projects/${id}/proposals/${pid}`),
  proposal: (id: string, pid: string, action: 'apply' | 'discard' | 'retry') =>
    req<{ proposal?: { id: string; timeline: Timeline; summary: string } }>('POST', `/api/projects/${id}/proposals/${pid}/${action}`),
  report: (id: string) => req<Report>('GET', `/api/projects/${id}/report`),
  render: (id: string, resolution: '720' | '1080' | '2160') => req<Job & { renderId: string; warnings: string[] }>('POST', `/api/projects/${id}/render`, { resolution }),
  job: (jid: string) => req<Job>('GET', `/api/jobs/${jid}`),
  health: () => req<{ stt: string; whisper: string; llm: boolean }>('GET', '/api/health'),
};

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
