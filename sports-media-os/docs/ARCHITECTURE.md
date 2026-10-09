# Architecture

## 1. Shape of the system

```
Browser ──► Next.js 16 (Vercel)            ──► Supabase (Postgres + Auth + Storage)
            • RSC pages, server actions          • RLS on every table
            • proxy.ts: session refresh          • business-rule triggers (rights, facts, approvals)
            • enqueues jobs, never calls AI      • job queue (jobs table) + AI ledger (ai_usage)
                                                         ▲
Worker (npm run worker — container/VPS, NOT serverless) ─┘
            • connector.fetch   RSS / JSON API → sources/events (SSRF-safe fetch)
            • trends.detect     signals, clustering, radar metrics
            • opportunity.ai_score / research.suggest / factcheck.assist
            • script.generate / hooks.generate / script.transform
            • (M3) video: FFmpeg, faster-whisper, OpenCV
```

Long work (AI calls, fetching, later transcription/rendering) never runs in a
request: the app inserts a `jobs` row, the worker claims it with
`claim_jobs()` (`FOR UPDATE SKIP LOCKED`) and reports back with
`complete_job()` / `fail_job()` (retry with backoff, permanent failures for bad
input). The UI polls job status (`<JobStatus>`). Serverless timeouts never matter.

## 2. Folder structure

```
sports-media-os/
├── app/
│   ├── (auth)/login/            login
│   ├── (onboarding)/welcome/    first project
│   ├── (app)/                   authenticated shell
│   │   ├── dashboard/           control room
│   │   ├── radar/               Sports Radar board (+ /radar/connectors)
│   │   ├── trends/              trend list + explanation
│   │   ├── opportunities/       list, detail (explained score, approval)
│   │   ├── research/            per-opportunity workspace + fact check
│   │   ├── rights/              Rights Center (assets, classification, approvals)
│   │   ├── content/             Kanban + item detail (Script Studio, Hook Studio)
│   │   ├── settings/            AI routing per task, usage ledger, defaults
│   │   └── clips|editor|thumbnails|calendar|analytics|agents/  (later milestones)
│   └── api/health/
├── components/                  ui/ primitives + one folder per module
├── lib/
│   ├── ai/                      provider abstraction, routing, pricing, providers/
│   ├── scoring/                 opportunity score (explained), hook score
│   ├── rights/                  classifier, editorial alternatives, service
│   ├── connectors/ net/         RSS/JSON parsing, normalisation, SSRF-safe fetch
│   ├── radar/ trends/           signals, clustering, metrics, board queries
│   ├── opportunities/ research/ factcheck/ content/ scripts/   domain services
│   ├── jobs/                    job contracts, enqueue, status actions
│   └── auth/ supabase/ db/ settings/ projects/ dashboard/ …
├── prompts/                     versioned system prompts + builders per task
├── workers/                     runner, context (project-scoped access), handlers/
├── agents/registry.ts           agent identities
├── supabase/migrations/         M1 0100…1000, M2 20261009 0100…0300
├── tests/unit|integration/      Vitest (unit + real Postgres)
└── e2e/                         Playwright
```

Layering rules:
- **UI never talks to the database directly.** Pages call `lib/<domain>/service.ts`;
  mutations go through server actions that validate with zod, call a service and
  map DB errors with `lib/db/errors.ts`.
- **Services take the DB client as a parameter** (`Db`), so the same code runs as
  the signed-in user (RLS) and inside the worker (service role).
- **The worker bypasses RLS**, so it loads every payload id with
  `ctx.loadOwned(table, id)` (scoped to the job's project) and filters every other
  query by `project_id`. A job can never touch another project's data, whatever
  ids its payload holds (tested in `tests/integration/worker.test.ts`).

## 3. RIGHTS-FIRST content engine

The system is **not** a downloader/reposter of highlights. It finds editorial
opportunities and turns them into original, monetizable content.

**Rights belong to assets, never to stories.** An asset is a `source` (external
URL: article, video link, social post, image) or a `video` (uploaded file). Each
asset carries its latest classification (`rights_checks`):

| Field | Column |
|---|---|
| ownership | `ownership` (owned · licensed · authorized · creator_provided · public_domain · third_party · unknown) |
| source | `source_detail` |
| license | `license` |
| commercial use | `commercial_use` (null = unknown) |
| authorization | `authorization_details` |
| transformation required | `transformation_required` |
| risk | `risk` |
| rights status | `status` → mirrored on the asset as `rights_status` |
| evidence | `evidence_url` |
| notes | `notes` |

| Status | Meaning | Enforced by |
|---|---|---|
| GREEN | may enter production under the recorded conditions | DB check: commercial use + real ownership basis + evidence (unless owned / public domain) |
| YELLOW | needs human review / documentation | usable only after `record_approval('rights', …)` on the latest check; **never** by automated workers |
| RED | never enters production | clip gate, READY gate |

`videos/sources.usable_in_production` is derived (read-only for every writer).
The production gate distinguishes **automated** writers (no `auth.uid()`:
workers, agents → GREEN only) from **humans** (GREEN or approved YELLOW).

**STORY ≠ FOOTAGE.** Story approval never depends on footage. When footage is
missing or not cleared, `lib/rights/alternatives.ts` suggests original formats
(commentary, voiceover, statistics, graphics, timeline, animation, maps,
original visuals) and documented ones (authorized/licensed footage, creator
material, compatible public sources, screenshots only when appropriate). The
chosen plan is stored in `stories.production_formats` and feeds Rights Safety in
the opportunity score.

## 4. Editorial pipeline and human checkpoints

```
connectors ─► sources ─► trends (signals, radar score, sweet spot)
                              │ create opportunity
                              ▼
                       opportunities ── score (explained) ── OPPORTUNITY → APPROVAL
                              │ start production
                              ▼
            research workspace (sources, claims↔sources, timeline, quotes, media,
            competitors, questions) ── fact check (human confirms; AI only suggests)
                              │
                              ▼
            story ── scripts (immutable versions, ≥3 angles) + 5 hooks
                              │ SCRIPT → APPROVAL
                              ▼
            Kanban: IDEA · RESEARCH · SCRIPT · REVIEW · PRODUCTION · READY · SCHEDULED · PUBLISHED · ANALYZING
```

| Rule (DB-enforced) | Error |
|---|---|
| opportunity/story → approved/rejected without a matching human decision | `APPROVAL_REQUIRED` |
| approvals recorded without a signed-in person | `APPROVAL_REQUIRES_HUMAN` |
| content → PRODUCTION+ without an approved **current** script | `SCRIPT_NOT_APPROVED` |
| content → READY+ with unconfirmed critical claims or uncleared clip material | `CONTENT_NOT_READY` |
| critical claim → confirmed without a supporting source | `CLAIM_UNSOURCED` (removing the last source downgrades it) |
| clip → production from RED / unchecked / unapproved YELLOW (automated: non-GREEN) | `RIGHTS_BLOCKED` |
| YELLOW approval on a stale or non-YELLOW check | `RIGHTS_APPROVAL_INVALID` |
| editing a script version | `SCRIPT_IMMUTABLE` |
| API publishing before READY | `PUBLISH_BLOCKED` |

Auto-publishing stays off (M5 adds publishing behind its own approval).

## 5. AI layer and cost control

```ts
interface AIProvider {            // lib/ai/types.ts
  id: "anthropic" | "openai";
  isConfigured(): boolean;
  complete(model, request, zodSchema?): Promise<{ text, usage, servedModel, latencyMs }>;
}
router.generateObject(task, request, zodSchema)   // lib/ai/router.ts
```

- **Per-task routing** (`lib/ai/models.ts`): discovery, scoring, research, script,
  fact_check. Precedence: Settings → env (`DISCOVERY_MODEL` … `FACT_CHECK_MODEL`)
  → code defaults. Defaults: Haiku 5.5 for high-volume discovery/scoring, Sonnet 5.5
  for research/script/fact check; Opus/Fable are opt-in per task.
- **Fallback chain**: primary → task fallback → `AI_FALLBACK_MODEL`. Unconfigured
  providers are skipped; rate limits, outages, refusals and invalid output move to
  the next model; every attempt is recorded.
- **Anthropic** via the official SDK: structured outputs (`output_config.format`),
  `effort` per task, adaptive thinking (default on 5.x), server-side refusal
  fallback (`fallbacks: "default"`) on models that support it.
- **Ledger**: every call → `ai_usage` (task, model, tokens, cost, latency, status);
  `ai_usage_summary()` feeds Settings. Prices in `lib/ai/pricing.ts` (unknown
  models are *unpriced*, never guessed).
- **Batch guard**: batch jobs estimate cost first; above `ai.batchCostLimitUsd`
  they need explicit confirmation. See `docs/AI_COST_CONTROL.md`.
- **Never invent facts**: prompts receive only stored facts/sources with ids;
  outputs are validated (ids must be in the provided set); AI claims start
  `uncertain`, AI links are `mentions` only, and AI never confirms or approves.

## 6. Security model

- **Auth**: Supabase Auth, sign-up disabled; `proxy.ts` refreshes sessions; every
  page/action re-verifies with `requireUser()`.
- **RLS everywhere**, generated from one template; composite FKs prevent
  cross-project links; `anon` has no grants; column grants stop role escalation.
- **Worker isolation**: service role + `loadOwned` + project filters (see §2).
- **SSRF**: connectors fetch user-provided URLs through `lib/net/safe-fetch.ts`
  (public IPs only, validated at connect time, redirects re-validated, size/time caps).
- **Secrets** server-only; storage private with project-folder policies; security headers.

## 7. Deployment

| Piece | Where | Why |
|---|---|---|
| Web app | Vercel (or Netlify) | standard Next.js hosting |
| DB/Auth/Storage | Supabase | migrations via `supabase db push` |
| Worker | any container host (Fly.io, Railway, Hetzner VPS, a local machine) | AI/fetch jobs now; FFmpeg/Whisper in M3 |

## 8. Decisions log

| # | Decision | Reason |
|---|---|---|
| D1 | Cache Components / Partial Prefetching **off** | per-user live data behind auth; revisit in M7 |
| D2 | Postgres job queue | no extra service; SKIP LOCKED is enough at this scale |
| D3 | Intel data is project-scoped | uniform RLS; duplication acceptable for V1 |
| D4 | No public sign-up | single-owner V1 |
| D5 | Guardrails as DB triggers | agents and workers write too |
| D6 | shadcn components written locally | registry unreachable from the build environment |
| D7 | Reuse `clipforge/` in M3/M4 | transcription, reframe, captions already exist |
| D8 | Rights on assets, not stories (STORY ≠ FOOTAGE) | great stories must not die for lack of footage; production defaults to original formats |
| D9 | AI only in the worker, routed per task | cost control, no request timeouts, one ledger |
| D10 | Automated vs human distinguished by `auth.uid()` in DB gates | YELLOW can never be used by an automated workflow, even after approval |

## 9. Known limits / risks

- **Copyright is the #1 business risk.** The Rights Center is a guard, not a license.
- **Storage cost** for long video (M3): Supabase Free caps uploads at 50 MB/file.
- **AI quality/cost** not yet measured with real keys in this environment — run
  `npm run ai:benchmark` before switching any batch task to a pricier model.
- **Competition estimate** is a proxy (publisher saturation in our own sources);
  platform-level competition data (YouTube search) arrives with M5 adapters.
