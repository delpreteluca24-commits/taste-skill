import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { config, ROOT } from './config';
import { ffmpeg, run } from './media/ffmpeg';
import type { Timeline } from '../core/timeline';
import type { Job } from './jobs';

let serveUrl: Promise<string> | null = null;

/** Webpack bundle of the composition, built once per process (the Player in the browser uses the same code). */
export function getBundle() {
  serveUrl ??= bundle({ entryPoint: path.join(ROOT, 'src/remotion/index.ts'), onProgress: () => undefined }).catch((e) => {
    serveUrl = null;
    throw e;
  });
  return serveUrl;
}

export const RESOLUTIONS = { '720': [720, 1280], '1080': [1080, 1920], '2160': [2160, 3840] } as const;

/** Final loudness: two-pass loudnorm to -14 LUFS / -1 dBTP, video stream copied. */
async function masterAudio(input: string, output: string) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']);
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(r.stderr);
  let af = 'loudnorm=I=-14:TP=-1:LRA=11';
  if (m) {
    const j = JSON.parse(m[0]);
    if (Number.isFinite(parseFloat(j.input_i)) && parseFloat(j.input_i) > -70) {
      af = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    }
  }
  // Limiter after loudnorm: AAC encoding adds overshoot, so keep sample peaks ≈ -1.5 dBFS for a -1 dBTP result.
  await ffmpeg(['-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', `${af},aresample=192000,alimiter=limit=0.84:level=false:attack=2:release=50,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
}

export async function renderTimeline(opts: {
  timeline: Timeline;
  media: Record<string, { src: string; voiceSrc?: string; width: number; height: number }>;
  assetBase: string;
  resolution: keyof typeof RESOLUTIONS;
  output: string;
  job?: Job;
}) {
  const { job } = opts;
  const [w, h] = RESOLUTIONS[opts.resolution];
  if (job) job.step = 'Preparo il compositing';
  const url = await getBundle();
  const inputProps = { timeline: opts.timeline, media: opts.media, assetBase: opts.assetBase, outWidth: w, outHeight: h };
  const browserExecutable = config.browserExecutable ?? undefined;
  const composition = await selectComposition({ serveUrl: url, id: 'Cutroom', inputProps, browserExecutable });
  const tmp = opts.output.replace(/\.mp4$/, '.raw.mp4');
  await fs.mkdir(path.dirname(opts.output), { recursive: true });
  const t0 = Date.now();
  await renderMedia({
    composition, serveUrl: url, codec: 'h264', outputLocation: tmp, inputProps, browserExecutable,
    concurrency: config.renderConcurrency ?? Math.max(1, os.cpus().length),
    crf: opts.resolution === '720' ? 23 : 20,
    x264Preset: 'veryfast',
    jpegQuality: 88,
    audioCodec: 'aac',
    enforceAudioTrack: true,
    onProgress: ({ progress }) => { if (job) { job.progress = progress * 0.92; job.step = `Rendering ${Math.round(progress * 100)}%`; } },
  });
  if (job) { job.step = 'Loudness -14 LUFS'; job.progress = 0.94; }
  await masterAudio(tmp, opts.output);
  await fs.rm(tmp, { force: true });
  return { renderMs: Date.now() - t0 };
}
