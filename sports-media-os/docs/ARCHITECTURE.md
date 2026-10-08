# Architecture

## 1. Shape of the system

```
Browser ──► Next.js 16 (Vercel)          ──► Supabase (Postgres + Auth + Storage)
            • RSC pages, server actions        • RLS on every table
            • proxy.ts: session refresh        • business-rule triggers
            • no secrets in the client         • job queue (jobs table)
                                                       ▲
Workers (container, NOT serverless) ───────────────────┘
            • video: FFmpeg, faster-whisper, OpenCV   (Milestone 3)
            • agents: orchestrator + AI providers      (Milestone 6)
```

Long work (transcription, rendering, agent runs) never runs in a request: the app
inserts a `jobs` row, a worker claims it with `claim_jobs()` and reports back with
`complete_job()` / `fail_job()`. Serverless timeouts never matter.

## 2. Folder structure

```
sports-media-os/
├── app/
│   ├── (auth)/login/          login page + signIn action
│   ├── (onboarding)/welcome/  first project
│   ├── (app)/                 authenticated shell (sidebar + topbar)
│   │   ├── dashboard/         control room
│   │   ├── settings/          workspace settings (+ actions)
│   │   ├── projects/new/
│   │   └── radar|trends|opportunities|research|content|clips|editor|
│   │       thumbnails|calendar|analytics|agents/   (roadmap placeholders)
│   └── api/health/            uptime probe
├── components/
│   ├── ui/                    shadcn/ui primitives (Radix + Tailwind)
│   ├── layout/ dashboard/ projects/ common/
├── lib/
│   ├── auth/                  DAL (getCurrentUser/requireUser), paths, signOut
│   ├── supabase/              server client, proxy session refresh
│   ├── projects/ settings/ dashboard/   domain services (server-only) + schemas
│   ├── db/errors.ts           DB guard errors → user messages
│   ├── navigation.ts          modules, groups, milestones
│   ├── env.ts / env.server.ts validated env (secrets server-only)
│   └── logger.ts              structured JSON logs
├── agents/registry.ts         agent identities (full definitions in M6)
├── supabase/
│   ├── config.toml            local stack (sign-up disabled)
│   └── migrations/            0100…0900, ordered
├── types/database.ts          generated (`npm run db:types`)
├── scripts/create-owner.mts   owner account (service role)
├── tests/unit|integration/    Vitest
├── e2e/                       Playwright
└── docs/
```

Planned additions: `lib/ai/`, `lib/scoring/`, `lib/research/`, `lib/rights/` (M2),
`lib/video/`, `lib/transcription/`, `workers/video/` (M3), `lib/analytics/` (M5),
`agents/<name>/`, `prompts/` (M6).

Layering rule: **UI components never talk to the database**. Pages call
`lib/*/service.ts` (server-only), mutations go through server actions that
validate with zod, call a service, and map errors with `lib/db/errors.ts`.

## 3. Data model

| Area | Tables |
|---|---|
| Identity | `users` (mirror of `auth.users`, app role), `projects`, `project_members` (viewer < editor < admin < owner) |
| Reference | `sports` |
| Intelligence | `events`, `sources`, `trends`, `trend_sources`, `opportunities`, `research_items`, `facts`, `rights_checks` |
| Story | `stories`, `scripts` (immutable versions), `hooks` |
| Media | `videos`, `video_segments` (transcript / scene / candidate), `clips`, `captions` |
| Packaging | `thumbnails`, `titles` |
| Production | `content_items` (Kanban unit: idea → … → analyzing) |
| Distribution | `platform_accounts`, `publishing_jobs`, `analytics` (snapshots) |
| Agents | `agent_runs`, `agent_tasks`, `approvals` (human checkpoints) |
| System | `settings`, `activity_logs` (append-only), `jobs` (queue) |

Conventions: UUID PKs, `created_at`/`updated_at` (trigger), scores as domain
`score` (0–100), probabilities as `probability` (0–1), enums for stable states,
JSONB only for genuinely unstructured metadata, `unique (id, project_id)` on
every project table so children use **composite FKs** — a row can never reference
another project's row (RLS doesn't protect FK targets; this does).

## 4. Security model

- **Auth**: Supabase Auth, email + password, public sign-up disabled. `proxy.ts`
  refreshes the session and redirects anonymous users; every page/action
  re-verifies via `requireUser()` (never trust the proxy alone).
- **RLS everywhere**: membership-based policies generated from one template
  (`project_id in (select private.project_ids_for_role('editor'))` — evaluated once
  per statement). `anon` has no grants. Column-level grants stop role
  escalation (`users.role`) and ownership changes (`projects.owner_id`).
- **Guardrails in the database** (apply to UI, agents, workers and SQL alike):

  | Rule | Error |
  |---|---|
  | content → READY/SCHEDULED/PUBLISHED with unconfirmed critical facts or RED/unchecked clip sources | `CONTENT_NOT_READY` |
  | clip → approved/rendering/rendered from a RED or unchecked video | `RIGHTS_BLOCKED` |
  | `rights_status` written directly instead of via `rights_checks` | `RIGHTS_BLOCKED` |
  | editing a script version | `SCRIPT_IMMUTABLE` |
  | API publishing job for content not past READY | `PUBLISH_BLOCKED` |

- **Secrets**: only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key reach the
  browser. AI keys and the Supabase secret key are server-only (`lib/env.server.ts`
  imports `server-only`); the secret key is used by scripts/workers, not the web app.
- **Storage**: private buckets, path `<project_id>/…`, policies mirror RLS.
- **Headers**: X-Frame-Options DENY, nosniff, strict referrer, permissions policy, HSTS in production. CSP with nonces is planned for M7.

## 5. AI provider abstraction (M2)

```ts
interface AIProvider {
  id: "anthropic" | "openai";
  generateText(input: { system: string; messages: Msg[]; model: string; maxTokens?: number }): Promise<{ text: string; usage: Usage }>;
  generateObject<T>(input: { …; schema: z.ZodType<T> }): Promise<{ object: T; usage: Usage }>;
}
```

Agents depend on the interface; `getProvider(settings.ai)` picks the
implementation. Anthropic uses the official SDK (structured outputs, adaptive
thinking on current models); default model `claude-opus-5-5`, switchable in
Settings. Usage and cost are written to `agent_runs`.

## 6. Video pipeline (M3)

Worker container: Node job runner + Python tools (reusing `clipforge/`).
Cost control: the AI never receives the full video — only transcript windows and
a few sampled frames of the top-N heuristic candidates.

## 7. Deployment

| Piece | Where | Why |
|---|---|---|
| Web app | Vercel (or Netlify) | standard Next.js hosting |
| DB/Auth/Storage | Supabase | migrations via `supabase db push` |
| Workers | any container host (Fly.io, Railway, Hetzner VPS, a local machine) | FFmpeg/Whisper need minutes of CPU/GPU, not serverless |

## 8. Decisions log

| # | Decision | Reason |
|---|---|---|
| D1 | Cache Components / Partial Prefetching **off** | every screen is per-user live data behind auth; simpler and robust. Revisit in M7. |
| D2 | Postgres job queue instead of Redis/BullMQ | one less service to run and pay for; SKIP LOCKED is enough at this scale; swap later if needed. |
| D3 | Intel data (events/sources/trends) is project-scoped | uniform RLS; cross-project duplication is acceptable for V1. |
| D4 | No public sign-up; owner via script | single-owner V1, no attack surface from open registration. |
| D5 | Guardrails as DB triggers, not only app code | agents and workers write too; rules must hold for every writer. |
| D6 | shadcn components written locally | the shadcn registry is unreachable from this build environment; same source, same API — `components.json` kept for local CLI use. |
| D7 | Reuse `clipforge/` for M3/M4 | it already implements transcription, reframe and captions; weeks saved. |

## 9. Known limits / risks

- **Copyright is the #1 business risk.** Clips of league broadcasts are routinely
  claimed or struck. The Rights Center blocks RED material, but it is a guard, not
  a license: the content strategy must rely on owned, licensed or clearly permitted
  footage, original commentary, data and graphics.
- **Storage cost**: hosted Supabase Free caps uploads at 50 MB/file; long-form video
  needs Pro + resumable uploads (or worker-local/R2 storage). Decide before M3.
- **AI cost**: the default model is the most capable Opus; bulk steps (segment
  scoring) may justify a cheaper model per task — measure first in M3.
