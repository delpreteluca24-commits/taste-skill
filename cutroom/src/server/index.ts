import { buildApp } from './app';
import { config } from './config';
import { store } from './store';
import { getBundle } from './render';

// Projects left "analyzing" by a crash/restart cannot resume a dead job: surface it instead of spinning forever.
for (const p of await store.list()) {
  if (p.status === 'analyzing') {
    p.status = 'error';
    p.error = 'Analisi interrotta dal riavvio del server: premi "Analizza" per riprendere (i file già analizzati sono in cache).';
    p.media = p.media.map((m) => (m.status === 'processing' ? { ...m, status: 'uploaded' } : m));
    await store.save(p);
  }
}

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
console.log(`Cutroom API on http://${config.host}:${config.port}  · STT=${config.stt} (${config.whisperModel}) · chat=${config.anthropicKey ? 'Claude' : 'rules'}`);
// Warm the Remotion bundle in the background so the first export starts faster.
getBundle().catch((e) => console.warn('Remotion bundle failed:', e.message));
