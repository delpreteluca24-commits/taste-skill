import { ffmpeg, probe, run, type Probe } from './ffmpeg';
import { config } from '../config';
import type { Range } from '../../core/timeline';

export const OUTPUT_FPS = 30;

/** Voice chain: rumble cut, noise reduction, presence EQ, gentle compression, per-clip loudness. */
export const VOICE_CHAIN = 'highpass=f=80,afftdn=nf=-25:tn=1,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=3:attack=10:release=180:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11';

/**
 * Normalize an upload into a render master (rotation baked in, CFR 30 fps, short GOP for exact seeking,
 * processed voice) and a light preview proxy for the browser Player.
 */
export async function normalize(input: string, master: string, preview: string, pr: Probe, onProgress?: (p: number) => void) {
  // Keep 4K sources at 4K (vertical 2160x3840 export), everything else capped at 1080p-class.
  const cap = Math.max(pr.width, pr.height) >= 3000 ? 3840 : 1920;
  const scale = `scale=w='if(gte(iw,ih),min(iw,${cap}),-2)':h='if(gte(iw,ih),-2,min(ih,${cap}))'`;
  const args = ['-i', input];
  if (!pr.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push(
    '-map', '0:v:0', '-map', pr.hasAudio ? '0:a:0' : '1:a:0',
    '-vf', `${scale},fps=${OUTPUT_FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    '-af', pr.hasAudio ? VOICE_CHAIN : 'anull', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', master,
  );
  await ffmpeg(args, (s) => onProgress?.(Math.min(0.85, (s / Math.max(0.1, pr.duration)) * 0.85)));
  await ffmpeg([
    '-i', master,
    '-vf', "scale=w='if(gte(iw,ih),min(iw,960),-2)':h='if(gte(iw,ih),-2,min(ih,960))'",
    ...(config.previewCodec === 'vp9'
      ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '36', '-b:v', '0', '-g', '10', '-row-mt', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', '10', '-keyint_min', '10', '-sc_threshold', '0']),
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', preview,
  ], (s) => onProgress?.(0.85 + Math.min(0.15, (s / Math.max(0.1, pr.duration)) * 0.15)));
}

/** Loudness of the ORIGINAL audio (QC: clipping / too quiet). */
export async function loudness(input: string): Promise<{ integrated: number; truePeak: number; lra: number }> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!m) return { integrated: -70, truePeak: -70, lra: 0 };
  const j = JSON.parse(m[0]);
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : -70);
  return { integrated: num(j.input_i), truePeak: num(j.input_tp), lra: Math.max(0, num(j.input_lra)) };
}

export async function silences(input: string, noiseDb = -38, minDur = 0.35): Promise<Range[]> {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-']);
  const out: Range[] = [];
  let start: number | null = null;
  for (const line of r.stderr.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (s) start = Math.max(0, parseFloat(s[1]));
    if (e && start !== null) { out.push({ start, end: parseFloat(e[1]) }); start = null; }
  }
  return out;
}

/** Scene changes, black and frozen segments (on the preview proxy: fast). */
export async function visualEvents(preview: string): Promise<{ scenes: number[]; black: Range[]; freeze: Range[] }> {
  const a = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', preview, '-an', '-vf', 'blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-60dB:d=0.8', '-f', 'null', '-']);
  const black: Range[] = [];
  const freeze: Range[] = [];
  let fs: number | null = null;
  for (const line of a.stderr.split('\n')) {
    const b = /black_start:([\d.]+) black_end:([\d.]+)/.exec(line);
    if (b) black.push({ start: parseFloat(b[1]), end: parseFloat(b[2]) });
    const s = /freeze_start: ([\d.]+)/.exec(line);
    const e = /freeze_end: ([\d.]+)/.exec(line);
    if (s) fs = parseFloat(s[1]);
    if (e && fs !== null) { freeze.push({ start: fs, end: parseFloat(e[1]) }); fs = null; }
  }
  const b = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', preview, '-an', '-vf', "select='gt(scene,0.32)',showinfo", '-f', 'null', '-']);
  const scenes: number[] = [];
  for (const line of b.stderr.split('\n')) {
    const m = /pts_time:([\d.]+)/.exec(line);
    if (m && /showinfo/.test(line)) scenes.push(Math.round(parseFloat(m[1]) * 100) / 100);
  }
  return { scenes, black, freeze };
}

/** 16 kHz mono float PCM for ASR and the energy envelope. */
export async function pcm16k(input: string, asrChain = true): Promise<Float32Array> {
  const af = asrChain ? ['-af', 'highpass=f=90,lowpass=f=7500,dynaudnorm=f=150:g=15'] : [];
  const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', input, '-vn', ...af, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']);
  if (r.code !== 0) throw new Error(`audio extraction failed: ${r.stderr.slice(-300)}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)).slice();
}

/** RMS envelope normalized 0..1, `fps` samples per second. */
export function energyEnvelope(pcm: Float32Array, fps: number, sr = 16000): number[] {
  const hop = Math.floor(sr / fps);
  const out: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += pcm[j] * pcm[j];
    out.push(Math.sqrt(s / hop));
  }
  const max = Math.max(1e-6, ...out);
  return out.map((v) => Math.round((v / max) * 1000) / 1000);
}

/** Decode small RGB frames at `fps` (for motion + face detection). */
export async function frames(preview: string, fps: number, width = 320): Promise<{ w: number; h: number; frames: Buffer[] }> {
  const pr = await probe(preview);
  const h = Math.round((pr.height / pr.width) * width / 2) * 2;
  const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', preview, '-an', '-vf', `fps=${fps},scale=${width}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (r.code !== 0) throw new Error(`frame extraction failed: ${r.stderr.slice(-300)}`);
  const size = width * h * 3;
  const out: Buffer[] = [];
  for (let i = 0; i + size <= r.stdout.length; i += size) out.push(r.stdout.subarray(i, i + size));
  return { w: width, h, frames: out };
}

/** Mean absolute luminance difference between consecutive frames, normalized 0..1. */
export function motionSeries(fr: Buffer[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1];
    const b = fr[i];
    let s = 0;
    let n = 0;
    for (let j = 0; j < a.length; j += 12) {
      s += Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]);
      n += 3;
    }
    out.push(s / n / 255);
  }
  const max = Math.max(1e-6, ...out);
  return out.map((v) => Math.round((v / max) * 1000) / 1000);
}
