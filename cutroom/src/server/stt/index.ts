import { Worker } from 'node:worker_threads';
import { ffmpeg } from '../media/ffmpeg';
import { config } from '../config';
import type { Transcript, Word } from '../../core/timeline';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
  worker.on('message', (m: any) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m) : p.reject(new Error(m.error));
  });
  worker.on('error', (e) => {
    for (const p of pending.values()) p.reject(e as Error);
    pending.clear();
    worker = null;
  });
  return worker;
}

/** Split segment-level text into words spread over the segment (fallback when word alignment is missing). */
function spread(text: string, start: number, end: number): { text: string; start: number; end: number }[] {
  const ws = text.trim().split(/\s+/).filter(Boolean);
  const total = ws.reduce((a, w) => a + w.length + 1, 0);
  let t = start;
  return ws.map((w) => {
    const d = ((w.length + 1) / Math.max(1, total)) * (end - start);
    const item = { text: w, start: t, end: t + d * 0.92 };
    t += d;
    return item;
  });
}

function toWords(mediaId: string, raw: { text: string; start: number; end: number }[]): Word[] {
  return raw
    .filter((w) => w.text.trim())
    .map((w, i) => ({ id: `${mediaId}_w${i}`, text: w.text.trim(), start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000, flags: [] }));
}

async function local(mediaId: string, pcm: Float32Array): Promise<Transcript> {
  const id = ++seq;
  const w = getWorker();
  const res: any = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, model: config.whisperModel, localDir: config.whisperLocalDir, language: config.language, audio: pcm });
  });
  const chunks: { text: string; timestamp: [number, number | null] }[] = res.chunks;
  const raw = res.granularity === 'word'
    ? chunks.map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
    : chunks.flatMap((c) => spread(c.text, c.timestamp[0], c.timestamp[1] ?? c.timestamp[0] + 2));
  return { language: config.language, model: `${config.whisperModel}${res.granularity === 'segment' ? ' (segment timing)' : ''}`, text: res.text.trim(), words: toWords(mediaId, raw) };
}

/** OpenAI-compatible transcription APIs (Groq / OpenAI) with word timestamps. */
async function remote(mediaId: string, audioFile: string, provider: 'groq' | 'openai'): Promise<Transcript> {
  const key = provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY missing`);
  const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
  const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';
  const flac = audioFile.replace(/\.[^.]+$/, '') + '.stt.flac';
  await ffmpeg(['-i', audioFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', flac]);
  const { readFile } = await import('node:fs/promises');
  const form = new FormData();
  form.append('file', new Blob([await readFile(flac)], { type: 'audio/flac' }), 'audio.flac');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (config.language !== 'auto') form.append('language', config.language);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!r.ok) throw new Error(`${provider} transcription failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j: any = await r.json();
  const words = (j.words ?? []).map((w: any) => ({ text: w.word, start: w.start, end: w.end }));
  // Whisper APIs return words without punctuation: re-attach punctuation from segments when possible.
  const punctuated = attachPunctuation(words, (j.segments ?? []).map((s: any) => s.text).join(' '));
  return { language: j.language ?? config.language, model: `${provider}:${model}`, text: j.text ?? '', words: toWords(mediaId, punctuated) };
}

export function attachPunctuation(words: { text: string; start: number; end: number }[], text: string) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let k = 0;
  return words.map((w) => {
    for (let j = k; j < Math.min(tokens.length, k + 4); j++) {
      if (bare(tokens[j]) === bare(w.text)) { k = j + 1; return { ...w, text: tokens[j] }; }
    }
    return w;
  });
}

export async function transcribe(mediaId: string, pcm: Float32Array, audioFile: string): Promise<Transcript> {
  if (config.stt === 'groq' || config.stt === 'openai') return remote(mediaId, audioFile, config.stt);
  return local(mediaId, pcm);
}

export function sttLabel() {
  return config.stt === 'local' ? `Whisper locale (${config.whisperModel})` : config.stt === 'groq' ? 'Groq whisper-large-v3-turbo' : 'OpenAI whisper-1';
}
