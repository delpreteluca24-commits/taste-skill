import Fastify, { type FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { config, ROOT } from './config';
import { store, newId } from './store';
import { getJob } from './jobs';
import * as svc from './service';
import { OpList } from '../core/ops';
import { PresetId } from '../core/timeline';

const require = createRequire(import.meta.url);
const ID = /^[a-z0-9]{6,32}$/;

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 4 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 30 } });
  await app.register(fastifyStatic, { root: path.join(ROOT, 'public'), serve: false });

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof svc.HttpError ? err.status : err instanceof z.ZodError ? 400 : err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.status(status).send({ error: err instanceof z.ZodError ? 'Richiesta non valida' : err.message, details: err instanceof z.ZodError ? err.issues : undefined });
  });

  // Media/assets are fetched by the Remotion renderer (other origin) and the Player.
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/files/') || req.url.startsWith('/assets/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  const baseUrl = () => `http://127.0.0.1:${config.port}`;
  const pid = (p: unknown) => {
    const id = (p as { id: string }).id;
    if (!ID.test(id)) throw new svc.HttpError(400, 'id non valido');
    return id;
  };

  // ── projects ──
  app.get('/api/health', async () => ({ ok: true, stt: config.stt, whisper: config.whisperModel, llm: !!config.anthropicKey }));
  app.get('/api/projects', async () => (await store.list()).map((p) => ({ id: p.id, name: p.name, status: p.status, updatedAt: p.updatedAt, media: p.media.length, versions: p.history.versions.length })));
  app.post('/api/projects', async (req) => {
    const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    return store.create(body.name);
  });
  app.get('/api/projects/:id', async (req) => svc.projectView(pid(req.params)));
  app.delete('/api/projects/:id', async (req) => { await store.remove(pid(req.params)); return { ok: true }; });

  // ── media ──
  app.post('/api/projects/:id/media', async (req) => {
    const id = pid(req.params);
    if (!(await store.get(id))) throw new svc.HttpError(404, 'Progetto non trovato');
    const tmpDir = path.join(config.dataDir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const files: { filename: string; tmp: string; size: number }[] = [];
    for await (const part of req.files()) {
      if (!/\.(mp4|mov|webm|m4v|mkv|mp3|wav|m4a|aac|ogg|flac|jpe?g|png|webp)$/i.test(part.filename)) throw new svc.HttpError(400, `Formato non supportato: ${part.filename}`);
      const tmp = path.join(tmpDir, newId());
      await pipeline(part.file, createWriteStream(tmp));
      if (part.file.truncated) throw new svc.HttpError(413, `${part.filename} supera il limite di dimensione`);
      files.push({ filename: path.basename(part.filename), tmp, size: fs.statSync(tmp).size });
    }
    if (!files.length) throw new svc.HttpError(400, 'Nessun file');
    return svc.addMedia(id, files);
  });
  app.put('/api/projects/:id/media/order', async (req) => svc.reorderMedia(pid(req.params), z.object({ order: z.array(z.string()) }).parse(req.body).order));
  app.patch('/api/projects/:id/media/:mediaId', async (req) => {
    const { mediaId } = req.params as { mediaId: string };
    if (!ID.test(mediaId)) throw new svc.HttpError(400, 'id non valido');
    const body = z.object({ use: z.enum(['story', 'insert']) }).parse(req.body);
    return svc.setMediaUse(pid(req.params), mediaId, body.use);
  });
  app.delete('/api/projects/:id/media/:mediaId', async (req) => {
    const { mediaId } = req.params as { mediaId: string };
    if (!ID.test(mediaId)) throw new svc.HttpError(400, 'id non valido');
    return svc.removeMedia(pid(req.params), mediaId);
  });

  // ── pipeline ──
  app.post('/api/projects/:id/analyze', async (req) => {
    const body = z.object({ preset: PresetId.optional() }).parse(req.body ?? {});
    return svc.startAnalysis(pid(req.params), body.preset);
  });
  app.post('/api/projects/:id/autoedit', async (req) => {
    const body = z.object({ preset: PresetId }).parse(req.body);
    return svc.runAutoEdit(pid(req.params), body.preset);
  });
  app.get('/api/jobs/:jobId', async (req) => {
    const j = getJob((req.params as { jobId: string }).jobId);
    if (!j) throw new svc.HttpError(404, 'Job non trovato');
    return j;
  });

  // ── history ──
  app.post('/api/projects/:id/undo', async (req) => svc.historyAction(pid(req.params), 'undo'));
  app.post('/api/projects/:id/redo', async (req) => svc.historyAction(pid(req.params), 'redo'));
  app.post('/api/projects/:id/versions/:vid/checkout', async (req) => svc.historyAction(pid(req.params), { checkout: (req.params as { vid: string }).vid }));
  app.get('/api/projects/:id/versions/:vid', async (req) => {
    const t = await store.getVersion(pid(req.params), (req.params as { vid: string }).vid);
    if (!t) throw new svc.HttpError(404, 'Versione non trovata');
    return t;
  });

  // ── editing ──
  app.post('/api/projects/:id/ops', async (req) => {
    const body = z.object({ ops: OpList, label: z.string().max(60).optional() }).parse(req.body);
    return svc.applyUserOps(pid(req.params), body.ops, body.label);
  });
  app.post('/api/projects/:id/chat', async (req) => {
    const body = z.object({
      message: z.string().min(1).max(1000),
      playhead: z.number().min(0).default(0),
      selection: z.object({ start: z.number(), end: z.number() }).nullable().optional(),
    }).parse(req.body);
    return svc.chat(pid(req.params), body.message, { playhead: body.playhead, selection: body.selection ?? null });
  });
  app.get('/api/projects/:id/proposals/:pid', async (req) => {
    const pr = await store.getProposal(pid(req.params), (req.params as { pid: string }).pid);
    if (!pr) throw new svc.HttpError(404, 'Proposta non trovata');
    return { id: pr.id, timeline: pr.timeline, summary: pr.summary };
  });
  app.post('/api/projects/:id/proposals/:pid/:action', async (req) => {
    const { pid: proposalId, action } = req.params as { pid: string; action: string };
    const id = pid(req.params);
    if (action === 'apply') return svc.applyProposal(id, proposalId);
    if (action === 'discard') return svc.discardProposal(id, proposalId);
    if (action === 'retry') return svc.retryProposal(id, proposalId);
    throw new svc.HttpError(404, 'Azione sconosciuta');
  });
  app.get('/api/projects/:id/report', async (req) => svc.report(pid(req.params)));

  // ── export ──
  app.post('/api/projects/:id/render', async (req) => {
    const body = z.object({ resolution: z.enum(['720', '1080', '2160']).default('1080') }).parse(req.body ?? {});
    return svc.startRender(pid(req.params), body.resolution, baseUrl());
  });
  app.get('/api/projects/:id/renders/:rid/file', async (req, reply) => {
    const id = pid(req.params);
    const { rid } = req.params as { rid: string };
    if (!ID.test(rid)) throw new svc.HttpError(400, 'id non valido');
    const p = await store.get(id);
    const name = `${(p?.name ?? 'cutroom').replace(/[^\w-]+/g, '_')}_${rid}.mp4`;
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.sendFile(`${id}/renders/${rid}.mp4`, store.root);
  });

  // ── files (range requests for the Player and the renderer) ──
  app.get('/files/:id/:mediaId/:name', async (req, reply: FastifyReply) => {
    const { id, mediaId, name } = req.params as { id: string; mediaId: string; name: string };
    if (!ID.test(id) || !ID.test(mediaId) || !(['master.mp4', 'preview.mp4', 'music.m4a', 'voice.wav', 'orig.wav'].includes(name) || /^original\.(jpe?g|png|webp)$/.test(name))) throw new svc.HttpError(400, 'file non valido');
    return reply.sendFile(`${id}/media/${mediaId}/${name}`, store.root);
  });
  app.get('/assets/sfx/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^[a-z]+\.wav$/.test(name)) throw new svc.HttpError(400, 'asset non valido');
    return reply.sendFile(`sfx/${name}`, path.join(ROOT, 'public'));
  });
  app.get('/assets/music/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^[a-z]+\.wav$/.test(name)) throw new svc.HttpError(400, 'asset non valido');
    return reply.sendFile(`music/${name}`, path.join(ROOT, 'public'));
  });
  const fontDir = path.join(path.dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');
  app.get('/assets/fonts/montserrat/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^montserrat-latin-\d{3}-normal\.woff2$/.test(name)) throw new svc.HttpError(400, 'font non valido');
    return reply.sendFile(name, fontDir);
  });

  // ── web app (production build) ──
  const web = path.join(ROOT, 'dist/web');
  if (fs.existsSync(web)) {
    await app.register(fastifyStatic, { root: web, prefix: '/', decorateReply: false, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/files/')) return reply.status(404).send({ error: 'Not found' });
      return reply.type('text/html').send(fs.readFileSync(path.join(web, 'index.html')));
    });
  }
  return app;
}
