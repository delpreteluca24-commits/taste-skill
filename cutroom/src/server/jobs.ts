import { newId } from './store';

export interface Job {
  id: string;
  type: 'analyze' | 'render';
  projectId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  step: string;
  error?: string;
  result?: unknown;
  createdAt: number;
}

const jobs = new Map<string, Job>();
const queue: { job: Job; fn: (j: Job) => Promise<unknown> }[] = [];
let running = 0;
const CONCURRENCY = 1; // heavy CPU work (ffmpeg, Whisper, Chromium): one at a time per process

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const { job, fn } = queue.shift()!;
    running++;
    job.status = 'running';
    fn(job)
      .then((r) => { job.status = 'done'; job.progress = 1; job.result = r; })
      .catch((e) => { job.status = 'error'; job.error = String(e?.message ?? e); console.error(`[job ${job.type}]`, e); })
      .finally(() => { running--; pump(); });
  }
}

export function enqueue(type: Job['type'], projectId: string, fn: (j: Job) => Promise<unknown>): Job {
  const job: Job = { id: newId(), type, projectId, status: 'queued', progress: 0, step: 'In coda', createdAt: Date.now() };
  jobs.set(job.id, job);
  queue.push({ job, fn });
  pump();
  // Forget finished jobs after an hour.
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 3_600_000 && j.status !== 'running') jobs.delete(id);
  return job;
}

export const getJob = (id: string) => jobs.get(id) ?? null;
export const activeJob = (projectId: string, type: Job['type']) =>
  [...jobs.values()].find((j) => j.projectId === projectId && j.type === type && (j.status === 'queued' || j.status === 'running')) ?? null;
