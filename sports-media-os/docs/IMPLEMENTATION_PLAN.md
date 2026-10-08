# Implementation plan

Status legend: ✅ done · 🟡 in progress · ⬜ not started

Rule for every milestone: tests → fixes → build → DB verification → feature check →
README/docs update → list what is missing. A milestone with a broken feature is not done.

## Environment baseline (checked 2026-10-08)

| Tool | Found | Notes |
|---|---|---|
| Node | 22.22 | Next.js 16.4 needs ≥ 20.9 |
| Python | 3.13 | `clipforge/` (reused in M3) pins 3.10–3.12 → worker image uses 3.12 |
| FFmpeg | 6.1.1 | with libass (captions burn-in) |
| Git | 2.43 | |
| Supabase CLI | via `npx supabase` (2.120) | local stack runs in Docker |
| OpenCV / faster-whisper | not installed | installed in the worker image (M3), never in the web app |
| Existing code | `clipforge/` (Python long→short pipeline: faster-whisper, reframe, ASS captions), `cutroom/` (TS editor) | M3/M4 reuse them instead of rewriting |

---

## ✅ Milestone 1 — Foundation

**Delivered**
- Next.js 16 (App Router, `proxy.ts`), TypeScript strict, Tailwind v4, shadcn/ui components (Radix).
- Supabase: SSR auth (cookie session refreshed in `proxy.ts`, re-verified in the DAL on every page/action), no public sign-up (owner created with `npm run create-owner`).
- Database foundation: 9 migrations — all spec tables + `project_members`, `trend_sources`, `approvals`, `jobs`; enums, domains, indexes, composite FKs, RLS, storage buckets/policies.
- DB-enforced guardrails: READY gate (unconfirmed critical facts / RED-unchecked rights), rights gate on clip production, rights status derived only from audited checks, immutable script versions, API publishing only after READY.
- Persistent job queue (Postgres, `FOR UPDATE SKIP LOCKED`, retries with backoff, lease recovery).
- Control-room layout (sidebar with the 13 modules, project switcher, user menu, mobile nav).
- Dashboard from a single RPC (`get_dashboard`): 6 KPIs, pipeline, today's/top opportunities, trending stories, production, ready, published, performing content, 14-day views chart, agent status. Real data only, explicit empty states.
- Multi-project: onboarding, create, switch (cookie validated against RLS).
- Settings: AI provider/model, Whisper model, caption preset, aspect ratio, clip duration, thresholds, auto-publish (default OFF), platform connections (NOT CONNECTED), storage.
- Tests: 41 unit, 21 DB integration (real Postgres + RLS), 8 E2E (desktop + mobile). CI workflow.

**Not in M1 (by design):** AI provider implementation, any data ingestion, video processing.

---

## ⬜ Milestone 2 — Intelligence: Radar, Opportunities, Research, Fact check, Rights

1. `lib/ai/`: `AIProvider` interface (`generateText`, `generateObject<T>(zodSchema)`, usage/cost reporting) + `AnthropicProvider` (official `@anthropic-ai/sdk`, structured outputs) + `OpenAIProvider`. Provider/model from Settings, keys from env. Every call logged to `agent_runs` (tokens, cost).
2. Source connectors (`lib/research/connectors/`): RSS + generic JSON API first (no scraping of sites that forbid it). Normalization → `sources` (dedupe on url + content hash) → `trends` (`trend_sources`).
3. `lib/scoring/opportunity.ts`: weighted score (trend 20, timeliness 15, curiosity 15, originality 15, audience 10, competition gap 10, feasibility 5, rights 5, monetization 5) + explanation, weights overridable in Settings.
4. Pages: `/radar` (filters: sport, date, score, trend status, competition, status), `/trends`, `/opportunities` (list + detail + approval checkpoint), `/research/[opportunityId]` (sources, articles, videos, quotes, facts, timeline, notes, questions, context).
5. Fact check UI (claim, source, status, confidence) and Rights Center (owner, origin, license, commercial use, authorization, risk, notes, status).
6. Content Kanban (`/content`) with drag & drop between stages; DB guard errors shown inline.
7. Script studio (generate/regenerate/shorten/expand/rewrite hook/change tone → new immutable version) and Hook generator (6 styles, scored).

**Exit criteria:** an opportunity flows from a real RSS item to an approved story with a versioned script, verified facts and a rights check; READY is blocked until facts/rights pass.

## ⬜ Milestone 3 — Video ingestion and clip engine

- Direct browser → Storage upload (resumable/TUS, MP4/MOV/MKV/WEBM), `videos` row, `video.ingest` job.
- `workers/video` (Node orchestrator + Python tools, Docker image with FFmpeg, faster-whisper, OpenCV). **Reuses `clipforge/`** modules (transcribe, chunking, snap, reframe, captions) instead of rewriting them.
- Pipeline: extract audio → transcribe (cached) → scene detection → candidate segments → heuristic score → AI analysis on **text + sampled frames of the top-N candidates only** (never the whole video) → ranking → top clips.
- Virality *potential* score (12 factors) with breakdown; labelled as potential, not prediction.
- RED/unchecked videos never enter automated production (already enforced in DB).

## ⬜ Milestone 4 — Captions, reframe, editor, thumbnails, titles
SRT/ASS (clean/bold/creator, word highlight, max 2 lines), 9:16 1080×1920 auto-reframe (speaker → face → subject → smart center), simple editor (trim, crop, caption style/position, zoom, mute, volume, export), 5 thumbnail concepts + image prompts, 5 honest titles scored on curiosity/clarity/CTR/accuracy.

## ⬜ Milestone 5 — Calendar, publishing, analytics
Day/week/month calendar; manual export package always available; official API adapters (YouTube Data API first) only when configured — OAuth tokens in a service-role-only table/Vault; analytics sync + manual entry; predicted vs actual.

## ⬜ Milestone 6 — Agents, orchestrator, learning loop
Agent definitions under `agents/<name>/` (identity, purpose, tools, input, output, constraints, memory), orchestrator state machine over `agent_tasks`, human approval checkpoints (opportunity, story, production, publishing), `/agents` center, prediction error + winning/losing patterns.

## ⬜ Milestone 7 — Optimization, security, deployment
Rate limiting on auth/AI actions, CSP with nonces, Sentry/OTel, load test of RLS queries, Cache Components evaluation, production deploy (Vercel + Supabase + worker host), backups, runbooks.

---

## Recommended order (business view)
M2 and M3 are where the product starts producing publishable output. M4 polishes it, M5 closes the loop with the platforms, M6 automates. If time is short, ship **M2 → M3 → M5 (manual export + manual analytics)** before investing in the full agent layer.
