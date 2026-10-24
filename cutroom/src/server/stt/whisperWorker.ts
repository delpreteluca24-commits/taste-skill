import { parentPort } from 'node:worker_threads';
import { env, pipeline } from '@huggingface/transformers';

/** Runs in a worker thread so ASR never blocks the API event loop. */
interface Job { id: number; model: string; localDir: string | null; language: string; audio: Float32Array }

let asr: any = null;
let loadedModel = '';

async function getPipeline(model: string, localDir: string | null) {
  if (asr && loadedModel === model) return asr;
  if (localDir) {
    env.localModelPath = localDir;
    env.allowLocalModels = true;
  }
  asr = await pipeline('automatic-speech-recognition', model, { dtype: 'q8' } as any);
  loadedModel = model;
  return asr;
}

parentPort!.on('message', async (job: Job) => {
  try {
    const p = await getPipeline(job.model, job.localDir);
    const langOpt = job.language && job.language !== 'auto' ? { language: LANG[job.language] ?? job.language, task: 'transcribe' } : {};
    const common = { chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 3, ...langOpt };
    let out: any;
    let granularity: 'word' | 'segment' = 'word';
    try {
      out = await p(job.audio, { ...common, return_timestamps: 'word' });
    } catch (e) {
      // Models exported without cross-attentions cannot align words: fall back to segments.
      granularity = 'segment';
      out = await p(job.audio, { ...common, return_timestamps: true });
    }
    parentPort!.postMessage({ id: job.id, ok: true, text: out.text, chunks: out.chunks ?? [], granularity });
  } catch (e: any) {
    parentPort!.postMessage({ id: job.id, ok: false, error: String(e?.message ?? e) });
  }
});

const LANG: Record<string, string> = { it: 'italian', en: 'english', es: 'spanish', fr: 'french', de: 'german', pt: 'portuguese' };
