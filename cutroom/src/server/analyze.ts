import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { ANALYZER_VERSION, config } from './config';
import { store, type Project } from './store';
import type { Job } from './jobs';
import { ffmpeg, probe } from './media/ffmpeg';
import { voiceTrack, energyEnvelope, frames, loudness, motionSeries, normalize, pcm16k, silences, visualEvents } from './media/process';
import { detectFaces } from './vision/faces';
import { transcribe, sttLabel } from './stt';
import { correctTranscript } from './llm/transcriptFix';
import { analyzeVideo, assignStoryRoles } from '../core/agents/story';
import type { EditContext, MediaAsset, RawAnalysis } from '../core/timeline';

const SAMPLE_FPS = 2;

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export const originalPath = (p: Project, m: MediaAsset) => store.mediaDir(p.id, m.id) + '/original' + (m.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? '.mp4');
export const masterPath = (p: Project, m: MediaAsset) => store.mediaDir(p.id, m.id) + (m.kind === 'audio' ? '/music.m4a' : '/master.mp4');
export const voicePath = (p: Project, m: MediaAsset) => store.mediaDir(p.id, m.id) + '/voice.wav';
export const imagePath = (p: Project, m: MediaAsset) => store.mediaDir(p.id, m.id) + '/original' + (m.filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.jpg');
export const previewPath = (p: Project, m: MediaAsset) => store.mediaDir(p.id, m.id) + (m.kind === 'audio' ? '/music.m4a' : '/preview.mp4');

/** Media Analysis + Transcription agents for one video file → RawAnalysis (cached by content hash). */
async function analyzeOne(p: Project, m: MediaAsset, report: (frac: number, step: string) => void): Promise<RawAnalysis> {
  const orig = originalPath(p, m);
  const master = masterPath(p, m);
  const preview = previewPath(p, m);
  const pr = await probe(orig);
  if (!pr.hasVideo) throw new Error(`${m.filename}: nessuna traccia video`);
  if (!existsSync(master) || !existsSync(preview)) {
    report(0.02, `${m.filename}: normalizzo video e audio (rotazione, 30 fps, voce)`);
    await normalize(orig, master, preview, pr, (f) => report(0.02 + f * 0.33, `${m.filename}: normalizzo video e audio`));
  }
  const key = `${await sha256(orig)}-${ANALYZER_VERSION}-${config.stt}-${config.whisperModel.replace(/\W+/g, '_')}-${config.language}`;
  const cached = await store.readCache<RawAnalysis>(key);
  if (cached) {
    report(1, `${m.filename}: analisi dalla cache`);
    return cached;
  }
  const mp = await probe(master);
  report(0.38, `${m.filename}: loudness, silenzi, scene`);
  const [loud, sil, vis] = await Promise.all([loudness(orig), silences(master), visualEvents(preview)]);
  report(0.45, `${m.filename}: movimento e volti`);
  const fr = await frames(preview, SAMPLE_FPS);
  const motion = motionSeries(fr.frames);
  const faces = await detectFaces(fr.frames, fr.w, fr.h, SAMPLE_FPS);
  report(0.55, `${m.filename}: trascrizione (${sttLabel()})`);
  const pcm = await pcm16k(master, true);
  const energy = energyEnvelope(await pcm16k(master, false), SAMPLE_FPS);
  let transcript = null;
  if (pr.hasAudio && loud.integrated > -60) {
    transcript = await transcribe(m.id, pcm, master);
    if (config.anthropicKey && transcript.words.length) {
      report(0.9, `${m.filename}: correzione sottotitoli (Claude)`);
      try {
        transcript = (await correctTranscript(transcript, `video "${p.name}", file ${m.filename}`)).transcript;
      } catch (e) {
        console.warn('[transcript] correction skipped:', (e as Error).message);
      }
    }
  }
  const raw: RawAnalysis = {
    duration: mp.duration, fps: mp.fps, width: mp.width, height: mp.height, hasAudio: pr.hasAudio,
    loudness: loud, silences: sil, scenes: vis.scenes, black: vis.black, freeze: vis.freeze,
    motion, energy, sampleFps: SAMPLE_FPS, faces, transcript,
  };
  await store.writeCache(key, raw);
  report(1, `${m.filename}: fatto`);
  return raw;
}

async function prepareMusic(p: Project, m: MediaAsset) {
  const out = masterPath(p, m);
  if (!existsSync(out)) await ffmpeg(['-i', originalPath(p, m), '-vn', '-af', 'loudnorm=I=-20:TP=-2', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '160k', out]);
  return probe(out);
}

/** Full project analysis job: every file in narrative order. */
export async function analyzeProject(projectId: string, job: Job) {
  const p0 = await store.get(projectId);
  if (!p0) throw new Error('Progetto non trovato');
  const media = [...p0.media].sort((a, b) => a.position - b.position);
  const n = Math.max(1, media.length);
  try {
    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      const report = (f: number, step: string) => { job.progress = Math.min(0.97, (i + f) / n); job.step = step; };
      if (m.kind === 'image') continue;
      await setMedia(projectId, m.id, { status: 'processing', error: undefined });
      try {
        if (m.kind === 'audio') {
          report(0.1, `${m.filename}: musica`);
          const pr = await prepareMusic(p0, m);
          await setMedia(projectId, m.id, { status: 'ready', duration: pr.duration });
          continue;
        }
        const raw = await analyzeOne(p0, m, report);
        if (!existsSync(voicePath(p0, m))) {
          report(0.98, `${m.filename}: isolo la voce`);
          await voiceTrack(masterPath(p0, m), voicePath(p0, m));
        }
        await store.saveRaw(projectId, m.id, raw);
        await store.saveAnalysis(projectId, m.id, analyzeVideo(m.id, m.filename, raw));
        await setMedia(projectId, m.id, { status: 'ready', voice: true, duration: raw.duration, width: raw.width, height: raw.height, fps: raw.fps });
      } catch (e: any) {
        await setMedia(projectId, m.id, { status: 'error', error: String(e?.message ?? e) });
        throw e;
      }
    }
  } catch (e) {
    await store.withLock(projectId, async () => {
      const p = await store.get(projectId);
      if (p) { p.status = 'error'; p.error = String((e as Error).message); await store.save(p); }
    });
    throw e;
  }
  job.step = 'Analisi completata';
}

async function setMedia(projectId: string, mediaId: string, patch: Partial<MediaAsset>) {
  await store.withLock(projectId, async () => {
    const p = await store.get(projectId);
    if (!p) return;
    p.media = p.media.map((m) => (m.id === mediaId ? { ...m, ...patch } : m));
    await store.save(p);
  });
}

/** EditContext for the engine: ready video analyses in narrative order + story roles across the whole project. */
export async function buildContext(p: Project): Promise<EditContext> {
  const videos = p.media.filter((m) => m.kind === 'video' && m.status === 'ready').sort((a, b) => a.position - b.position);
  const analyses: EditContext['analyses'] = {};
  for (const m of videos) {
    // Semantic analysis is cheap and pure: recompute from the raw measurements so engine fixes apply to old projects.
    const raw = await store.getRaw(p.id, m.id);
    if (raw) analyses[m.id] = analyzeVideo(m.id, m.filename, raw);
  }
  const music = p.media.find((m) => m.kind === 'audio' && m.status === 'ready');
  return assignStoryRoles({ analyses, order: videos.filter((m) => analyses[m.id]).map((m) => m.id), musicId: music?.id ?? null, images: p.media.filter((m) => m.kind === 'image' && m.status === 'ready').sort((a, b) => a.position - b.position).map((m) => ({ id: m.id, name: m.filename })) });
}
