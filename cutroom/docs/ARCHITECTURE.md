# Cutroom — AI Social Video Editor · Architecture v1

> Status: **Phase 1 implemented** (this folder). Owner: CTO agent. Date: 2026-10-01.
> Labels: FACT (source/date) · ESTIMATE · HYPOTHESIS · UNKNOWN.

## 1. Real objective
Turn 2+ raw phone clips into one vertical 9:16 short that looks hand-edited, in minutes, and let the user steer
the edit by chat. The asset is the **edit engine + timeline model**, not the effects.

## 2. Problem
- Raw creator footage: long pauses, false starts, intros, static framing, no captions, uneven audio.
- "AI editors" apply effects randomly → cheap look. Every decision here must have a *reason* that is stored on
  the element (`reason` field) and shown in the UI.
- The edit must stay editable: chat commands patch the timeline incrementally, never regenerate from scratch.

## 3. Simplest solution (Phase 1, built)
One local Node process + browser UI, €0 infra:

```
UPLOAD ─► NORMALIZE (ffmpeg: rotation, CFR, voice chain) ─► MEDIA ANALYSIS (probe, silences, loudness,
scenes, black/freeze, motion, faces) ─► TRANSCRIPTION (Whisper, word timestamps, hallucination filter)
─► SEMANTIC ANALYSIS (sentences, roles, emphasis) ─► EDIT DECISION LIST ─► TIMELINE ─► PREVIEW (Remotion Player)
─► CHAT ─► TIMELINE PATCH (ops) ─► QC ─► FINAL RENDER (Remotion + ffmpeg loudnorm) ─► MP4
```

## 4. Scalable solution (target 100k users)
| Concern | Phase 1 (now) | Scale (Phase 3+) |
|---|---|---|
| Web | Vite SPA served by the API | Same SPA on a CDN (Vercel/Cloudflare) |
| API | Fastify, single process | Stateless API (Fastify or Next.js route handlers) behind a LB |
| Data | JSON files per project (`ProjectStore` interface) | Supabase Postgres (+ RLS), same shapes (jsonb timelines) |
| Media | local disk | Supabase Storage / R2 (private, signed URLs), content-addressed |
| Jobs | in-process queue, concurrency 1 | Postgres queue (pgmq) + autoscaled workers |
| STT | transformers.js Whisper on CPU, or Groq/OpenAI API | GPU workers (faster-whisper large-v3-turbo) or API |
| Render | Remotion `renderMedia` local | Remotion Lambda / Cloud Run render workers, per-plan concurrency |
| LLM | optional Claude (`ANTHROPIC_API_KEY`), rule fallback | Claude with prompt caching; per-workspace budget guard |

Why not Next.js now: the editor is a client-heavy SPA; heavy work (ffmpeg, Whisper, Remotion's webpack bundler
+ headless Chromium) must live in long-running workers, not serverless handlers. The API surface is small and
framework-agnostic, so moving it to Next.js route handlers later is mechanical. Stack stays TypeScript + React +
Tailwind (+ Supabase in Phase 2) as requested.

Why Remotion + FFmpeg: one React composition is both the in-browser preview (Player) and the final render, so
preview == export for captions, graphics, zoom and SFX. FFmpeg does what it is best at: probing, normalization,
the voice chain (noise reduction, EQ, compression) and final two-pass loudness. **License (FACT, remotion.dev
license FAQ, accessed 2026-09-30):** free for individuals and companies of up to 3 people; a company license is
needed above that — re-check before commercial launch.

## 5. Architecture

### 5.1 Folder structure
```
cutroom/
  docs/ARCHITECTURE.md        this file
  scripts/gen-sfx.mjs         synthesizes the SFX library with ffmpeg (no third-party audio, no licensing risk)
  public/                     fonts + generated SFX (served to Player and renderer)
  src/core/                   PURE, isomorphic TypeScript (server, browser, Remotion). Fully unit-tested.
    timeline.ts               zod schemas: MediaAsset, VideoAnalysis, Timeline, elements, ops
    timemap.ts                source↔output time mapping, retiming of anchored elements
    presets.ts                8 editing modes (VIRAL … CINEMATIC) as numeric parameters
    text.ts                   Italian/English lexicons: fillers, emphasis words, CTA/hook cues
    agents/                   one file per agent (deterministic, explainable)
      story.ts hook.ts cut.ts subtitle.ts motion.ts sound.ts reframe.ts camera.ts qc.ts score.ts
    autoEdit.ts               orchestrates the agents: analyses → EDL → Timeline
    ops.ts                    timeline operations (the only way to change a timeline)
    interpreter.ts            rule-based chat → ops (IT/EN), fallback when no LLM key
    history.ts                version graph: undo / redo / checkout
    diff.ts                   human summary of what an op changed ("Ho eliminato 4.2s di pause…")
  src/remotion/               the composition (Player + renderer share it)
  src/server/                 Fastify API, ffmpeg/whisper/face workers, store, jobs, render
  src/web/                    React editor (upload → analyze → edit → chat → export)
  tests/                      vitest (core unit tests + server pipeline test on synthetic media)
```

### 5.2 Agents (each has one responsibility)
Agents are deterministic modules. The LLM is optional and only *advises* (chat intent, sentence roles);
it never writes the timeline directly — its output is validated ops.

| # | Agent | Where | Responsibility |
|---|---|---|---|
| 1 | Media Analysis | `server/media/*` | probe, normalize, silences, loudness, peaks, scenes, black/freeze frames, motion |
| 2 | Transcription | `server/stt/*` | word timestamps, hallucination-loop filter, silence-gated words |
| 3 | Story | `core/agents/story.ts` | sentences, roles HOOK/CONTEXT/PROBLEM/CURIOSITY/PAYOFF/CTA, A-roll vs B-roll |
| 4 | Hook | `core/agents/hook.ts` | hook score, intro removal, optional cold-open teaser, title card |
| 5 | Cut | `core/agents/cut.ts` | keep ranges: pauses, fillers, false starts, repeats, B-roll highlight windows |
| 6 | Subtitle | `core/agents/subtitle.ts` | 2–5 word groups, line breaking, emphasis (numbers, money, alert words) |
| 7 | Motion Graphics | `core/agents/motion.ts` | keyword pop-ups, counters, title card, CTA, progress bar, density limits |
| 8 | Sound Design | `core/agents/sound.ts` | SFX tied to graphics/transitions/punchlines, density cap; music ducking plan |
| 9 | Reframing | `core/agents/reframe.ts` + `server/vision/faces.ts` | face/saliency crop center per segment, headroom |
| 10 | Camera | `core/agents/camera.ts` | jump-cut punch-ins (100↔108%), emphasis zooms (112–120%), slow push-ins |
| 11 | Quality Control | `core/agents/qc.ts` | VIDEO_QC checks, auto-fix or warning |
| 12 | Chat Editing | `core/interpreter.ts` + `server/llm/*` | message → ops → validation → proposal |
| 13 | Render | `server/render.ts` | Remotion render + ffmpeg loudnorm/limiter, 720/1080/2160 |
| – | Retention Score | `core/agents/score.ts` | observable signals → score + concrete suggestions (never "viral") |

### 5.3 Timeline data model (`core/timeline.ts`)
Every element: `id, start, end (output seconds), type, properties, source?, layer` + `reason` + optional
`anchor {mediaId, srcStart, srcEnd}`. Anchored elements (zooms, keyword graphics, SFX) are retimed after every
cut, so a chat cut never leaves a graphic on the wrong word. Subtitles are *derived* from transcript words that
survive the cut (+ per-word text overrides), so they can never drift.

```
Timeline { clips[], cuts[], subtitles[], graphics[], transitions[], audio[] (sfx), music[], effects[],
           crop[], zoom[], captionStyle, settings (preset params), metadata { sourceOrder, warnings } }
```

### 5.4 Chat command flow
`message → USER_INTENT (LLM tool call or rules) → ops[] (zod-validated) → applyOps (pure) → QC → PROPOSAL`
The proposal is previewed immediately; **Apply** commits a new version, **Undo** discards, **Try another version**
re-runs with a variation seed. Committed versions form a graph: Undo/Redo/checkout any version.

## 6. Database (Phase 2, Supabase) — Phase 1 stores the same shapes as JSON files
```sql
create table workspaces (id uuid pk, name text, plan text, monthly_render_seconds int, created_at timestamptz);
create table workspace_members (workspace_id uuid, user_id uuid, role text check (role in ('owner','editor','viewer')),
  primary key (workspace_id, user_id));
create table projects (id uuid pk, workspace_id uuid not null, name text, preset text, head_version_id uuid,
  status text, created_by uuid, created_at timestamptz, updated_at timestamptz);
create table media_assets (id uuid pk, workspace_id uuid not null, project_id uuid not null, position int not null,
  filename text, storage_path text, sha256 text, duration_s real, width int, height int, fps real,
  rotation int, has_audio bool, status text, unique (project_id, position));
create table media_analyses (media_id uuid pk, workspace_id uuid not null, analysis jsonb, transcript jsonb,
  faces jsonb, analyzer_version text, created_at timestamptz);
create table timeline_versions (id uuid pk, workspace_id uuid not null, project_id uuid not null,
  parent_id uuid, label text, author text check (author in ('ai','user','system')), ops jsonb,
  timeline jsonb not null, created_at timestamptz);            -- append-only
create table chat_messages (id uuid pk, workspace_id uuid not null, project_id uuid not null, role text,
  content text, ops jsonb, version_id uuid, created_at timestamptz);
create table render_jobs (id uuid pk, workspace_id uuid not null, project_id uuid not null, version_id uuid,
  resolution text, status text, progress real, output_path text, error text, render_ms int, created_at timestamptz);
create table usage_events (id bigserial pk, workspace_id uuid not null, kind text, units numeric, cost_cents int,
  created_at timestamptz);                                      -- partitioned by month at scale
-- indexes: (workspace_id, created_at desc) on every table; (project_id, created_at desc) on versions/messages
```

## 7. Supabase RLS (Phase 2 draft)
```sql
create function private.is_member(ws uuid, roles text[]) returns boolean language sql stable
security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
   where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any(roles)) $$;
alter table projects enable row level security;           -- same pattern on every table
create policy p_read  on projects for select to authenticated using (private.is_member(workspace_id, '{owner,editor,viewer}'));
create policy p_write on projects for all    to authenticated using (private.is_member(workspace_id, '{owner,editor}'))
  with check (private.is_member(workspace_id, '{owner,editor}'));
-- timeline_versions: insert only (no update/delete) for editors; render_jobs/usage_events: written by service role only.
-- storage: private bucket 'media', path <workspace_id>/<project_id>/...; policies via (storage.foldername(name))[1].
```
Service role key only in workers. Signed URLs (short TTL) for playback. Upload size/duration limits per plan.

## 8. API (Phase 1, implemented)
| Method | Path | Effect |
|---|---|---|
| GET/POST | `/api/projects` | list / create |
| GET/DELETE | `/api/projects/:id` | project + media + head timeline / delete |
| POST | `/api/projects/:id/media` | multipart upload, appended in the order received |
| PUT | `/api/projects/:id/media/order` | reorder (narrative order) |
| DELETE | `/api/projects/:id/media/:mediaId` | remove a clip |
| POST | `/api/projects/:id/analyze` | job: normalize + analysis + transcript + faces |
| POST | `/api/projects/:id/autoedit` | `{preset}` → new version "Auto Edit (PRESET)" |
| GET | `/api/projects/:id/versions` | version graph + head |
| POST | `/api/projects/:id/undo` · `/redo` · `/versions/:vid/checkout` | history |
| POST | `/api/projects/:id/ops` | apply validated ops from the UI (fine tune) → new version |
| POST | `/api/projects/:id/chat` | message → proposal `{reply, ops, summary, timeline}` |
| POST | `/api/projects/:id/proposals/:pid/apply` · `/discard` · `/retry` | proposal lifecycle |
| GET | `/api/projects/:id/report` | retention score + QC |
| POST | `/api/projects/:id/render` | `{resolution}` → job → `/api/renders/:rid/file` |
| GET | `/api/jobs/:id` | job progress |
| GET | `/files/...` | range-enabled media (preview/master), fonts, SFX |

## 9. UI
LEFT media & clips (order, analysis scores) · CENTER 9:16 Player · BOTTOM timeline tracks VIDEO / ZOOM / TEXT /
GRAPHICS / SFX / MUSIC · RIGHT AI chat (summary of changes + Apply / Undo / Try another version) · TOP preset,
undo/redo, versions, retention score, QC, export. Workflow: Upload → Analyze → AI Edit → Preview → Chat → Fine
tune → Export.

## 10. Automations
Analysis is cached per file hash + analyzer version. Auto-edit runs right after analysis. QC auto-fixes before
every render. Final loudness two-pass to -14 LUFS / -1 dBTP (ESTIMATE of platform targets; re-check).

## 11. Roadmap
| Phase | Scope | Exit criterion |
|---|---|---|
| **1 — MVP (done here)** | Definition-of-Done flow end-to-end, local | 15/15 DoD items on real footage |
| 2 — Quality | Whisper small/turbo default, LLM story/hook (Claude), B-roll overlay on matching phrases, music library with licenses, caption style editor, keyboard trimming | 10 real edits judged "publishable" by the founder with ≤ 3 chat commands each |
| 3 — SaaS | Supabase auth/DB/storage + RLS, queue + workers, Remotion Lambda, quotas, Stripe | 1 paying pilot user |
| 4 — Scale | GPU STT, render autoscaling, templates/brand kits, team workspaces, analytics loop | unit economics positive per render minute |

## 12. Risks
| Risk | Mitigation |
|---|---|
| **Focus:** 5th initiative in 3 days (Lilla → PROJECT M → ClipForge → Content Factory → Cutroom) | Cutroom reuses the same core ideas; choose ONE revenue test (FD-011) before Phase 2 |
| Whisper base/tiny quality in Italian (hallucination loops on noisy kitchen audio — TEST RESULT 2026-10-01) | loop filter + silence gating; default model `Xenova/whisper-small`; API option (Groq/OpenAI) |
| Render speed (TEST RESULT: ~9 s per output second at 1080p, 4 CPU, Remotion) | 720p draft export, Lambda at scale |
| Remotion license above 3 people | budget it before hiring / selling (FACT above) |
| Public repo | never commit user footage or transcripts; `data/` is git-ignored |
| "Viral" promises | only a Content Retention Score built on observable signals |

## 13. Tests
- Unit (vitest): time mapping, cut agent, subtitles grouping/emphasis, ops + retiming, interpreter (IT/EN
  commands from the spec), history graph, QC, score, auto-edit invariants (order preserved, no overlaps, duration).
- Pipeline: synthetic ffmpeg media through normalize/analysis with a fake transcriber.
- E2E (manual, documented in README): upload real clips → analyze → auto edit → chat → undo/redo → export MP4.
