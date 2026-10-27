import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import type { MediaAsset, PresetId, RawAnalysis, Timeline, VideoAnalysis } from '../core/timeline';
import { emptyHistory, type History } from '../core/history';
import type { Op } from '../core/ops';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  media: MediaAsset[];
  status: 'new' | 'analyzing' | 'ready' | 'error';
  error?: string;
  preset: PresetId;
  history: History;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  proposalId?: string;
  versionId?: string;
  status?: 'proposed' | 'applied' | 'discarded' | 'info' | 'error';
  ops?: Op[];
  engine?: 'claude' | 'rules';
}

export interface Proposal {
  id: string;
  baseVersionId: string;
  message: string;
  ops: Op[];
  reply: string;
  summary: string;
  label: string;
  variant: number;
  engine: 'claude' | 'rules';
  timeline: Timeline;
}

export interface RenderRecord {
  id: string;
  versionId: string;
  resolution: '720' | '1080' | '2160';
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  file?: string;
  error?: string;
  createdAt: string;
  renderMs?: number;
  sizeBytes?: number;
}

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 12);

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}
async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; } catch { return null; }
}

/** File-system project store. Same shapes as the Phase-2 Postgres tables (see docs/ARCHITECTURE.md §6). */
export class ProjectStore {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly root = path.join(config.dataDir, 'projects')) {}

  dir(id: string, ...p: string[]) { return path.join(this.root, id, ...p); }
  mediaDir(id: string, mediaId: string) { return this.dir(id, 'media', mediaId); }

  /** Serializes read-modify-write cycles per project. */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  async list(): Promise<Project[]> {
    if (!existsSync(this.root)) return [];
    const ids = await fs.readdir(this.root);
    const ps = await Promise.all(ids.map((id) => this.get(id)));
    return ps.filter((p): p is Project => !!p).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string) { return readJson<Project>(this.dir(id, 'project.json')); }
  async save(p: Project) { p.updatedAt = new Date().toISOString(); await writeJson(this.dir(p.id, 'project.json'), p); return p; }
  async create(name: string): Promise<Project> {
    const now = new Date().toISOString();
    const p: Project = { id: newId(), name, createdAt: now, updatedAt: now, media: [], status: 'new', preset: 'premium', history: emptyHistory() };
    await this.save(p);
    return p;
  }
  async remove(id: string) { await fs.rm(this.dir(id), { recursive: true, force: true }); }

  getRaw(id: string, mediaId: string) { return readJson<RawAnalysis>(this.dir(id, 'analysis', `${mediaId}.raw.json`)); }
  saveRaw(id: string, mediaId: string, raw: RawAnalysis) { return writeJson(this.dir(id, 'analysis', `${mediaId}.raw.json`), raw); }
  getAnalysis(id: string, mediaId: string) { return readJson<VideoAnalysis>(this.dir(id, 'analysis', `${mediaId}.json`)); }
  saveAnalysis(id: string, mediaId: string, a: VideoAnalysis) { return writeJson(this.dir(id, 'analysis', `${mediaId}.json`), a); }

  getVersion(id: string, vid: string) { return readJson<Timeline>(this.dir(id, 'versions', `${vid}.json`)); }
  saveVersion(id: string, vid: string, t: Timeline) { return writeJson(this.dir(id, 'versions', `${vid}.json`), t); }

  async getChat(id: string) { return (await readJson<ChatMessage[]>(this.dir(id, 'chat.json'))) ?? []; }
  saveChat(id: string, msgs: ChatMessage[]) { return writeJson(this.dir(id, 'chat.json'), msgs); }

  getProposal(id: string, pid: string) { return readJson<Proposal>(this.dir(id, 'proposals', `${pid}.json`)); }
  saveProposal(id: string, p: Proposal) { return writeJson(this.dir(id, 'proposals', `${p.id}.json`), p); }

  async getRenders(id: string) { return (await readJson<RenderRecord[]>(this.dir(id, 'renders.json'))) ?? []; }
  saveRenders(id: string, r: RenderRecord[]) { return writeJson(this.dir(id, 'renders.json'), r); }

  cacheFile(key: string) { return path.join(config.dataDir, 'cache', `${key}.json`); }
  readCache<T>(key: string) { return readJson<T>(this.cacheFile(key)); }
  writeCache(key: string, v: unknown) { return writeJson(this.cacheFile(key), v); }
}

export const store = new ProjectStore();
