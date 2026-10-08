# Sports Media OS

Operating system for an AI-first sports media company: one control room for
discovery, research, fact check, rights, production, publishing, analytics and agents.

**Status: Milestone 1 (Foundation) complete** — see [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
Architecture and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Stack: Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres, Auth, Storage) · Vitest · Playwright.

## Quick start (local)

Requirements: Node ≥ 20.9, Docker (for the local Supabase stack).

```bash
cd sports-media-os
npm install
npm run db:start                      # local Supabase (Postgres, Auth, Storage, REST) + migrations
npx supabase status -o env            # copy API_URL, PUBLISHABLE_KEY, SECRET_KEY into .env.local
cp .env.example .env.local            # then fill the three values above
npm run create-owner -- --email you@example.com --password 'a-long-password' --name "Your Name"
npm run dev                           # http://localhost:3000
```

Sign-up is disabled on purpose: the first account created with `create-owner` is the workspace owner.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | lint + typecheck + unit tests |
| `npm test` | unit tests (no DB needed) |
| `npm run test:db` | integration tests against the local Postgres (RLS, guardrails, job queue, storage) |
| `npm run test:e2e` | Playwright (needs `npm run build` and the local stack) |
| `npm run db:start` / `db:stop` / `db:reset` | local Supabase lifecycle (`db:reset` re-applies all migrations) |
| `npm run db:lint` | plpgsql lint of the schema |
| `npm run db:types` | regenerate `types/database.ts` after a migration |
| `npm run create-owner` | create the owner (or reset their password) |

## Environment

See [.env.example](.env.example). Only `NEXT_PUBLIC_*` values reach the browser.
`SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` are server-only and must never be committed.

## Deploy (when ready)

1. Create a Supabase project (Free works for M1/M2; long video needs Pro — see ARCHITECTURE §9).
2. `npx supabase link --project-ref <ref>` then `npx supabase db push` (applies `supabase/migrations`).
3. In Supabase Auth settings: disable sign-ups, set Site URL to your domain.
4. Vercel: import the repo with root directory `sports-media-os`, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and AI keys when M2 lands).
5. `npm run create-owner` with `.env.local` pointing at the hosted project.

Video/agent workers (M3+) run on a container host, not on Vercel.

## Milestone 1 — what works

- Login / logout, protected routes, open-redirect-safe `next` param.
- Multi-project onboarding, creation and switching.
- Control-room dashboard with real data only (empty states until data exists).
- Settings: AI provider/model, Whisper model, caption preset, aspect ratio, clip duration, score thresholds, auto-publish (off by default), platform connections shown as NOT CONNECTED.
- Database with RLS and DB-enforced guardrails (fact-check READY gate, rights gate, immutable scripts, publish gate), job queue, private storage.
- Tests: 41 unit · 21 DB integration · 8 E2E.

## What is missing (next milestones)

AI provider implementation, source connectors, opportunity scoring and research
workspace (M2) · video ingestion and clip engine (M3) · captions/reframe/editor/
thumbnails/titles (M4) · calendar, publishing adapters, analytics (M5) · agents and
learning loop (M6) · rate limiting, CSP, observability, production deploy (M7).
