import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

/** Channel-level brand kit (Phase 1: one channel per install). Slogan is applied to every new edit. */
export interface Brand { slogan: string | null }
const file = () => path.join(config.dataDir, 'brand.json');

export async function loadBrand(): Promise<Brand> {
  try { return { slogan: null, ...JSON.parse(await fs.readFile(file(), 'utf8')) }; } catch { return { slogan: null }; }
}
export async function saveBrand(b: Brand) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file(), JSON.stringify(b));
}
