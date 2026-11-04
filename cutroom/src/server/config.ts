import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function firstExisting(paths: (string | undefined)[]): string | null {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

export const config = {
  port: parseInt(process.env.PORT ?? '5174', 10),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: path.resolve(process.env.CUTROOM_DATA ?? path.join(ROOT, 'data')),
  /** Whisper model (transformers.js ONNX). Needs word-timestamp support (cross attentions). */
  whisperModel: process.env.CUTROOM_WHISPER_MODEL ?? 'Xenova/whisper-small',
  /** Directory with pre-downloaded models (offline installs). Remote download is used when empty. */
  whisperLocalDir: process.env.CUTROOM_MODELS_DIR ?? null,
  /** 'it' | 'en' | … | 'auto' */
  language: process.env.CUTROOM_LANGUAGE ?? 'it',
  /** local | groq | openai */
  stt: (process.env.CUTROOM_STT ?? (process.env.GROQ_API_KEY ? 'groq' : 'local')) as 'local' | 'groq' | 'openai',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? null,
  claudeModel: process.env.CUTROOM_CLAUDE_MODEL ?? 'claude-opus-5-5',
  browserExecutable:
    process.env.CUTROOM_BROWSER ??
    firstExisting([
      '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    ]),
  /** Preview proxy codec: h264 (Chrome, Safari, Edge, Firefox) or vp9 (also open-source Chromium builds). */
  previewCodec: (process.env.CUTROOM_PREVIEW_CODEC === 'vp9' ? 'vp9' : 'h264') as 'h264' | 'vp9',
  renderConcurrency: parseInt(process.env.CUTROOM_RENDER_CONCURRENCY ?? '0', 10) || null,
  maxUploadBytes: 2 * 1024 * 1024 * 1024,
};

export const ANALYZER_VERSION = '1';
