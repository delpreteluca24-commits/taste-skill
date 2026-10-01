import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { ffmpeg } from './media/ffmpeg';

/** Channel-level brand kit (Phase 1: one channel per install). Slogan is applied to every new edit. */
export interface Brand { slogan: string | null; intro?: { file: string; duration: number } }
const file = () => path.join(config.dataDir, 'brand.json');

export async function loadBrand(): Promise<Brand> {
  try { return { slogan: null, ...JSON.parse(await fs.readFile(file(), 'utf8')) }; } catch { return { slogan: null }; }
}
export const brandIntroFile = () => path.join(config.dataDir, 'brand', 'intro.mp4');

/** Cut the intro take from the ORIGINAL upload (no processing at all on the audio). */
export async function saveBrandIntro(original: string, start: number, end: number): Promise<{ file: string; duration: number }> {
  const out = brandIntroFile();
  await fs.mkdir(path.dirname(out), { recursive: true });
  await ffmpeg(['-ss', String(Math.max(0, start)), '-to', String(end), '-i', original, '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]);
  return { file: 'brand/intro.mp4', duration: Math.round((end - start) * 100) / 100 };
}

export async function saveBrand(b: Brand) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file(), JSON.stringify(b));
}
