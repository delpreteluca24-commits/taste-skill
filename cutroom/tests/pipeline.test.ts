import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, probe } from '../src/server/media/ffmpeg';
import { energyEnvelope, frames, motionSeries, normalize, pcm16k, silences, visualEvents } from '../src/server/media/process';
import { attachPunctuation } from '../src/server/stt';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-'));
const src = path.join(dir, 'src.mp4');

beforeAll(async () => {
  // 4 s landscape test pattern rotated 90° (like phone footage): 1.5 s tone, 1 s silence, 1.5 s tone.
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=4',
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1.5,2.5),0,0.4*sin(2*PI*440*t))':s=44100:d=4",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:v', 'rotate=90', '-shortest', src,
  ]);
});

describe('media pipeline (ffmpeg)', () => {
  it('normalizes to CFR 30 fps master + preview with rotation baked in', async () => {
    const pr = await probe(src);
    const master = path.join(dir, 'master.mp4');
    const preview = path.join(dir, 'preview.mp4');
    await normalize(src, master, preview, pr);
    const m = await probe(master);
    expect(Math.round(m.fps)).toBe(30);
    expect(m.hasAudio).toBe(true);
    expect(Math.abs(m.duration - 4)).toBeLessThan(0.2);
    expect(m.width).toBe(pr.width);
    expect(m.height).toBe(pr.height);
    const pv = await probe(preview);
    expect(Math.max(pv.width, pv.height)).toBeLessThanOrEqual(960);
  });

  it('detects the silent gap, scene activity and audio energy', async () => {
    const master = path.join(dir, 'master.mp4');
    const sil = await silences(src, -38, 0.35);
    expect(sil.some((s) => s.start > 1.3 && s.end < 2.8)).toBe(true);
    const vis = await visualEvents(path.join(dir, 'preview.mp4'));
    expect(vis.black.length).toBe(0);
    const pcm = await pcm16k(master, false);
    expect(pcm.length).toBeGreaterThan(16000 * 3.5);
    const env = energyEnvelope(pcm, 2);
    expect(Math.max(...env)).toBe(1);
    const fr = await frames(path.join(dir, 'preview.mp4'), 2, 160);
    expect(fr.frames.length).toBeGreaterThanOrEqual(7);
    expect(motionSeries(fr.frames).some((v) => v > 0)).toBe(true);
  });

  it('re-attaches punctuation to API word timestamps', () => {
    const out = attachPunctuation([{ text: 'ciao', start: 0, end: 0.3 }, { text: 'ragazzi', start: 0.3, end: 0.8 }], 'Ciao, ragazzi!');
    expect(out.map((w) => w.text)).toEqual(['Ciao,', 'ragazzi!']);
  });
});
