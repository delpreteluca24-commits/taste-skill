# Content Factory — Architecture Proposal v0.1

> **Status:** PROPOSAL, awaiting founder approval (FD-004). **No code is written until it's approved.**
> **Owner:** CEO / CTO agent · **Date:** 2026-09-30 · **Autonomy:** LEVEL 2 (PREPARE) · **Spend:** €0
> **Input:** founder's "Master System Prompt — AI YouTube Content Factory". The prompt was **cut off at Agent 11 (Voice)**. Anything after that point is UNKNOWN, and the parts of this doc that depend on it are marked `PENDING-SPEC`.

Claim labels follow `CLAUDE.md`: FACT (with source and date) · ESTIMATE · HYPOTHESIS · UNKNOWN.

---

## 0. Executive summary (read this if nothing else)

1. **Build a pipeline engine, not a "team of agents".** A fixed workflow runs the steps in a set order and decides what happens next. The LLM only does the work that needs judgment. It never controls the flow. Of the 11 "agents" in the spec, **6 are LLM modules** and **5 are ordinary code**: orchestration, video editing, captions, voice, rendering.
2. **The real product is the data model:** versioned artifacts, each with a status, a record of where it came from, its cost and its rights. That model stays the same from internal tool to SaaS. Only the runtime underneath it changes.
3. **Humans approve; AI never does.** This is enforced **in the database**: only a logged-in human with the reviewer role can set `approved`. Workers physically can't.
4. **Compliance comes first and is the only wedge worth betting on.** The market for AI video tools is crowded. What's left is "editorial-grade, sourced, rights-safe content", because YouTube has made its policy on mass-produced content explicit (FACT below). That's a HYPOTHESIS to validate, not a business plan.
5. **Scope conflict with Lilla. The founder must decide (FD-005).** Recommendation: build a **shared production core** (script → voice → visuals → captions → render → QA → export) that Lilla needs anyway for Gates 2–3. Add the research and fact-check modules only when a factual channel exists.

---

## 1. Real objective
Cut **founder minutes per published video** while keeping the editorial quality high enough to stay monetizable. Secondary goal: create a reusable asset (the platform) that might later be sold.

Success metrics (factory level):
| Metric | Definition | Target (HYPOTHESIS) |
|---|---|---|
| Founder time / video | minutes of human work from idea to export | ≤ 45 min (Short) after Phase 1 |
| First-pass approval rate | % of artifacts approved without regeneration, per module | ≥ 60% |
| Cost / finished minute | € in API + infra / published minutes | tracked; ceiling set per run |
| Fact-check escape rate | false claims found after approval | 0 tolerated → incident |
| Relative retention | vs the channel's own baseline | tracked from the 4th video onward |

## 2. Problem to solve
- **Production is not yet proven to be the bottleneck.** No video has been produced yet (see `current-state.md`). Automating an unknown process locks in the wrong process. → The factory must be **extracted from real production**, not designed in a vacuum.
- Solo founder: every human gate costs time. Too many gates and the founder stops using it; too few and quality and compliance collapse.
- Platform risk (FACT, YouTube Help "Channel monetization policies", accessed 2026-09-30): *"July 15, 2025: … renaming this policy from 'repetitious content' to 'inauthentic content' … content must not be mass-produced, generic, repetitive"*. A spam factory is a monetization risk by design.

## 3. Simplest solution (Phase 1, ~€0 of infra)
- **TypeScript CLI + local worker** on the founder's machine or in a Claude Code session. Every step is a function with a typed input and output.
- **Supabase free tier** as the single source of truth (Postgres + Storage). We use the same schema from day 1, so there's no migration later.
- **Remotion Studio** (local) to preview and render. **FFmpeg** for audio and video work.
- **Minimal review UI:** 3 pages in Next.js running locally (project → artifacts → final review). Nothing is deployed.
- Only 1 format: `short_explainer_v1` (9:16, 30–60 s).
- Cost: API usage only. Per-Short ESTIMATE < €2 (LLM + TTS + a few images). **Re-check pricing before any spend.**

## 4. Most scalable solution (target at 100k users)
- **Web:** Next.js on Vercel (UI + API route handlers).
- **Data:** Supabase: Postgres + RLS, Auth, Realtime (run progress), Storage. Move hot media to Cloudflare R2 when egress costs matter (ESTIMATE: at scale, video egress is the main cost of storage).
- **Workflows:** a durable workflow engine: **Trigger.dev** (open source and self-hostable, so no lock-in; long-running tasks without serverless timeouts). The alternative is Inngest. HYPOTHESIS, to confirm with a spike in Phase 2.
- **Render farm:** containerized Remotion + FFmpeg workers behind a queue with concurrency limits per plan. Remotion Lambda is an option if bursty load makes it worthwhile.
- **Multi-tenant:** `workspace_id` on every row; RLS everywhere; quotas and budget caps per workspace.

## 5. Architecture

### 5.1 Principles (ADR summary)
| # | Decision | Why |
|---|---|---|
| ADR-01 | The orchestrator is a **deterministic DAG per format template**, not an LLM | reproducible, debuggable and cheap; stops agents from overwriting each other |
| ADR-02 | Every output is an **immutable, versioned artifact** (append-only); an edit creates a new version | traceability; no destructive overwrites; diffs between versions |
| ADR-03 | **Only humans approve** (enforced in the DB) | spec §4 "Never pretend that an AI-generated result is correct" |
| ADR-04 | **Ports and adapters** for every provider (LLM, TTS, STT, image, video, search, storage, publish) | swap providers without touching the pipeline; test with fixtures |
| ADR-05 | **Pre-flight cost guard:** every call is estimated and checked against the run and workspace budget *before* it's made | no surprise bills; matches the OS rule "no generation loops" |
| ADR-06 | **Rights ledger:** every media asset has a `rights_status`; rendering or publishing is **blocked** if any asset is `unknown`, or `third_party` without a license | spec §4 copyright safety |
| ADR-07 | A **third-party YouTube URL is reference only:** metadata via the Data API; no download of third-party media | FACT (YouTube ToS, accessed 2026-09-30): you may not *"access, reproduce, download … any Content except (a) as expressly authorized by the Service; or (b) with prior written permission"* |
| ADR-08 | **Quote-grounded fact-check:** a verdict must cite an exact passage from the stored source snapshot, and code checks that the passage really exists | stops an LLM from "confirming" a claim with an invented quote |
| ADR-09 | **Remotion** for composition, **FFmpeg** for processing | deterministic rendering; see the license note in §11 |
| ADR-10 | Everything is **idempotent per step** (`idempotency_key = hash(step, inputs, prompt_version)`) | safe retries; cache for identical inputs |

### 5.2 Components
```
┌──────────────┐   ┌───────────────────────────────────────────────┐
│  Web (Next)  │──▶│  API (route handlers / server actions)        │
│  review UI   │   └───────────────┬───────────────────────────────┘
└──────┬───────┘                   │ enqueue run / review RPC
       │ Realtime                  ▼
┌──────▼───────────────────────────────────────┐   ┌───────────────┐
│ Supabase: Postgres+RLS · Auth · Storage      │◀─▶│ Workflow      │
│ (single source of truth)                     │   │ engine (DAG)  │
└──────────────────────────────────────────────┘   └──────┬────────┘
                                                          │ step tasks
            ┌──────────────┬──────────────┬───────────────┼──────────────┐
            ▼              ▼              ▼               ▼              ▼
      LLM modules     Provider ports   Media worker   Render worker   Publish/analytics
   (strategy, research, (LLM, TTS, STT,  (FFmpeg:       (Remotion:      (YouTube Data +
    fact-check, hooks,  image, search)   loudness,      9:16, 16:9)     Analytics APIs)
    script, visual)                      align, mux)
```

### 5.3 Map from the spec's agents to modules
| Spec agent | Implementation | LLM? | Notes |
|---|---|---|---|
| 1 Orchestrator | workflow engine + DAG template | ❌ | the only component that can finalize a run (spec) |
| 2 Strategy | `strategy.brief` | ✅ | JSON output; probabilistic language, never "will go viral" |
| 3 Research | `research.dossier` | ✅ + search/fetch | stores a **snapshot** of each source (text + sha256 + accessedAt) |
| 4 Fact Check | `factcheck.claims` | ✅ + code | PASS/WARNING/FAIL; corrections recorded (never silent) |
| 5 Content Strategist | merged into `strategy.brief` (angle/promise/retention/CTA) | ✅ | separate from Strategy only if evals show it's worth it |
| 6 Script | `script.write` | ✅ | N variants on request; anti-cliché rules |
| 7 Hook | `hooks.generate` | ✅ | 8 types + a 5-criteria rubric; score = an internal ESTIMATE |
| 8 Visual Director | `visual.plan` | ✅ | scene JSON per spec §8; no "filler" images |
| 9 Video Editor | Remotion composition from `scene_plan` | ❌ | deterministic |
| 10 Caption | alignment from word timestamps + preset | ❌ | presets: Bold/Minimal/Creator/Podcast/Documentary/Kids |
| 11 Voice | TTS port (with word timestamps) | ❌ | `PENDING-SPEC` for the rest of the spec |
| 12+ | QA, Metadata/SEO, Thumbnail, Publish, Analytics, … | mixed | `PENDING-SPEC`; QA outlined in §9 |

### 5.4 Pipeline `short_explainer_v1`
```
intake ─▶ strategy.brief ─▶ research.dossier ─▶ factcheck(dossier claims)
                                   │
                         [GATE A · brief + dossier]   (optional, ON at the start)
                                   ▼
             hooks.generate ∥ script.write ─▶ factcheck(script claims) ─▶ similarity check vs the channel's past scripts
                                   │
                         [GATE B · hook + script + fact report]   (REQUIRED)
                                   ▼
voice.tts (word timestamps) ─▶ scene_plan (timed from the timestamps) ─▶ visual.plan ─▶ assets (parallel per scene, rights assigned)
                                   │
                         [GATE C · visual plan + assets]   (optional, ON at the start)
                                   ▼
captions ─▶ render 9:16 ─▶ metadata (titles/description/tags) ∥ thumbnail concept ─▶ qa.report
                                   │
                         [GATE D · final approval]   (REQUIRED)
                                   ▼
                     export package  →  (Phase 2) publish as PRIVATE
```
- A **gate** is a `waiting_review` state on the run. The founder's decision resumes the DAG.
- Gates A and C are switched off once the first-pass approval rate for that module is ≥ 80% over 10 runs (a measured decision, not a feeling).
- `needs_revision` → the module is run again with the reviewer's comment as input and creates a new version.

### 5.5 LLM layer (verified 2026-09-30 in the Anthropic reference docs)
- Default model: **`claude-opus-5-5`** for every module. Cheaper tiers (`claude-sonnet-5-5`, `claude-haiku-4-5`) are used only if the founder approves it **after** an eval shows no quality loss on that module.
- JSON output: **structured outputs** (`output_config.format` with a JSON Schema), validated again with Zod.
- Research: server tools **`web_search_20260209` / `web_fetch_20260209`**. We save a snapshot ourselves; we don't trust search snippets.
- Fact-check: **citations** on documents give us `cited_text` plus the position in the source. ⚠️ FACT: citations **aren't compatible** with `output_config.format` → this takes 2 steps (a cited check, then JSON normalization) or a strict tool. The ADR-08 check (the quote exists in the snapshot) stays in code.
- Cost: **prompt caching** on stable system prompts and rubrics; the **Batch API (−50%)** for anything not urgent (e.g. regenerating title variants or analytics summaries).
- Every prompt is versioned (the `prompts` table). Every call is logged to `provider_calls` with its tokens and cost.

## 6. Database (Postgres / Supabase) — draft

```sql
-- Enums
create type member_role     as enum ('owner','editor','reviewer','viewer');
create type artifact_status as enum ('generated','reviewed','approved','rejected','needs_revision');
create type rights_status   as enum ('user_owned','licensed','public_domain','third_party','unknown');
create type check_verdict   as enum ('pass','warning','fail');
create type run_status      as enum ('queued','running','waiting_review','succeeded','failed','cancelled');

-- Tenancy
workspaces        (id uuid pk, name, plan, monthly_budget_cents int, created_at)
workspace_members (workspace_id fk, user_id fk auth.users, role member_role, pk(workspace_id,user_id))
channels          (id, workspace_id, platform, name, external_id, language, audience text,
                   made_for_kids bool, brand_preset jsonb, caption_preset text)

-- Production
projects          (id, workspace_id, channel_id, title, input_type ('topic'|'idea'|'url'|'youtube_url'|'video'),
                   input jsonb, format ('short'|'long'), target_audience, budget_cap_cents, created_by, created_at)
artifacts         (id, workspace_id, project_id, kind, version int, parent_id, status artifact_status,
                   content jsonb, storage_path, produced_by ('module:<key>@<ver>'|'human'),
                   prompt_id, provider, model, input_hash, cost_cents, created_at,
                   unique(project_id, kind, version))
                   -- kind: brief|research_dossier|fact_report|hooks|script|voiceover|scene_plan|visual_plan|
                   --       captions|video|titles|description|tags|thumbnail_concept|qa_report
artifact_reviews  (id, workspace_id, artifact_id, reviewer_kind ('human'|'automated'), reviewer_id null,
                   from_status, to_status, comment, created_at)          -- append-only

-- Evidence
sources           (id, workspace_id, project_id, url, title, publisher, published_at, accessed_at,
                   relevance smallint check (relevance between 0 and 100),
                   snapshot_path, content_sha256, rights_status)
claims            (id, workspace_id, project_id, artifact_id, text, claim_type ('fact'|'statistic'|'quote'|'opinion'),
                   verdict check_verdict, rationale, evidence jsonb,     -- [{source_id, quote, quote_verified}]
                   correction jsonb null, created_at)                    -- {from, to, reason} never silent

-- Media & rights
assets            (id, workspace_id, project_id, kind ('image'|'video'|'audio'|'music'|'font'),
                   origin ('generated'|'stock'|'upload'|'screen_recording'), storage_path, sha256,
                   rights_status, license jsonb,  -- {licensor, license_url, evidence_path, expires_at}
                   provider, prompt, created_at)

-- Execution
pipeline_runs     (id, workspace_id, project_id, template, status run_status, current_step,
                   budget_cap_cents, spent_cents, started_at, finished_at, error)
run_steps         (id, workspace_id, run_id, step_key, status, attempt, output_artifact_id,
                   idempotency_key unique, error, started_at, finished_at)
provider_calls    (id, workspace_id, run_id, step_id, provider, model, operation, units jsonb,
                   cost_cents, latency_ms, status, created_at)           -- append-only, partitioned by month
renders           (id, workspace_id, project_id, scene_plan_artifact_id, aspect ('9:16'|'16:9'),
                   width, height, status, output_path, duration_ms, render_ms, created_at)

-- Distribution & learning
publications      (id, workspace_id, project_id, channel_id, render_id, platform, external_id,
                   visibility, ai_disclosure bool, made_for_kids bool, approved_by, published_at)
metric_snapshots  (id, workspace_id, publication_id, captured_at, views, avg_view_duration_s,
                   avg_view_pct, likes, comments, subs_gained, raw jsonb)
prompts           (id, module, version, template, output_schema jsonb, is_active, created_at)  -- global, read-only
```
Scaling to 100k users:
- `workspace_id` is denormalized onto every table → RLS without joins. Composite indexes `(workspace_id, created_at desc)` and `(project_id, kind, version desc)`.
- `provider_calls` and `metric_snapshots` are partitioned by month; raw data is aged out to cold storage.
- Media is content-addressed (sha256) → dedup; lifecycle rules delete intermediate renders after N days.
- Heavy work (renders, LLM calls) never runs inside a DB transaction or an HTTP request.

## 7. Supabase RLS policies (draft)
```sql
-- Helper (private schema, not exposed via the API)
create function private.has_role(ws uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any(roles));
$$;

-- Reads: any member
create policy read_member on public.projects for select to authenticated
  using (private.has_role(workspace_id, '{owner,editor,reviewer,viewer}'));
-- (same for channels, artifacts, artifact_reviews, sources, claims, assets, pipeline_runs, run_steps, renders, publications, metric_snapshots)

-- Project writes: owner/editor
create policy write_projects on public.projects for insert to authenticated
  with check (private.has_role(workspace_id, '{owner,editor}'));

-- Artifacts: NO direct insert/update/delete for clients
revoke insert, update, delete on public.artifacts from authenticated, anon;
-- Status changes only through RPC public.review_artifact(artifact_id, to_status, comment):
--   security definer; checks has_role(ws,'{owner,reviewer}') for approved|rejected,
--   '{owner,editor,reviewer}' for needs_revision; validates the transition; writes artifact_reviews.
-- Human edit → RPC public.revise_artifact(artifact_id, content) → new version, produced_by='human'.

-- Guard trigger on artifacts (also stops the service role):
--   * approved/rejected are terminal: no update to content/status
--   * status → 'approved' requires auth.uid() IS NOT NULL (i.e. a human session) → workers can't approve

-- Costs: owners only can read; append-only
create policy read_costs on public.provider_calls for select to authenticated
  using (private.has_role(workspace_id, '{owner}'));
revoke insert, update, delete on public.provider_calls from authenticated, anon;  -- writes: service role only

-- Storage: private bucket 'media', path = <workspace_id>/<project_id>/...
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,editor,reviewer,viewer}'));
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,editor}'));
-- Playback via short-lived signed URLs. Uploads require a rights declaration (API-side check).
```
Security: `service_role` only in workers (as a secret in the workflow runtime, never in the client or the repo). `prompts` can be read by authenticated users and written only by migration. Provider webhooks are verified with HMAC.

## 8. API (Phase 2; in Phase 1 the CLI calls the same functions)
| Method | Path | Role | Effect |
|---|---|---|---|
| POST | `/api/projects` | editor | creates the project (Zod validation of the input; `youtube_url` → reference only) |
| POST | `/api/projects/:id/runs` | editor | starts the DAG `{template, budget_cap_cents}` |
| GET | `/api/runs/:id` | viewer | status + steps (live updates via Realtime) |
| POST | `/api/runs/:id/cancel` | editor | cancels; preserves logs |
| POST | `/api/artifacts/:id/review` | reviewer | RPC `review_artifact` → resumes the DAG if the gate is satisfied |
| POST | `/api/artifacts/:id/regenerate` | editor | new version with instructions (cost guard) |
| PATCH | `/api/artifacts/:id` | editor | human edit → new version |
| POST | `/api/assets/upload-url` | editor | signed URL; `rights_status` + license **required** |
| POST | `/api/renders` | editor | `{scene_plan_artifact_id, aspect}` |
| GET | `/api/projects/:id/export` | viewer | zip: mp4, srt/vtt, metadata.json, sources.json, qa_report.json |
| POST | `/api/publications` | owner | only with the render **approved** + QA not FAIL; default `private` |
| POST | `/api/webhooks/:provider` | — | HMAC verified, idempotent |

Internal module contract (spec, not code):
`Module<I,O> = { key, version, inputSchema, outputSchema, estimateCost(I), run(I, ctx) → O }`. `ctx` exposes providers, budget, logger and storage. Modules have no access to the DB.

## 9. UI (minimal and focused on review)
1. **Projects:** list + "New" (topic / URL / video + audience + format).
2. **Project workspace:** a stepper on the left (DAG with statuses) · the active artifact in the center with a status badge · on the right: versions/diff, cost, "Approve / Needs revision / Reject" plus a comment.
3. **Fact panel:** a table of claims → verdict → source quote (highlighted) → link to the snapshot.
4. **Timeline preview:** Remotion Player with scenes, captions and voice; per-asset rights badges (red if `unknown`).
5. **QA and export:** a checklist, blockers shown in red, the export button.
Mobile: read-only review plus approval (the founder has little time; approving from a phone matters).

QA report (deterministic checks + LLM): every claim is PASS or an accepted WARNING · no asset has `unknown` rights · captions sit inside the 9:16 safe zones, minimum size · duration within the Shorts limit (re-check the current limit) · loudness normalized (ESTIMATE target ≈ −14 LUFS) · AI-disclosure flag decided · made-for-kids flag decided · **similarity to the channel's recent scripts** below a threshold (defends against "inauthentic content") · no banned phrases or clichés.

## 10. Automations
- DAG runs with automatic retries (max 2 per step, exponential backoff) **only for transient errors**. A validation failure → `needs_revision`, never an infinite retry.
- Cost guard: estimate → check → reserve → call → reconcile. Hard cap per run and per workspace per month.
- Kill switch: reads the `EMERGENCY_STOP` equivalent (a workspace flag + a global flag) before every step.
- Notifications: "gate waiting" and "run failed" by email or push (Phase 2).
- Nightly analytics sync (YouTube Analytics API) → `metric_snapshots` → a weekly report comparing retention with the baseline.
- Weekly **learning loop**: approval rate and top reasons for rejection per module → proposed prompt changes as a PR (a human approves them).

## 11. Roadmap (gated, like the OS)
| Phase | Content | Exit criterion | Cost (ESTIMATE) |
|---|---|---|---|
| **P0 · Spec** (now) | this doc + the complete spec + founder decisions | FD-004/005/006 closed | €0 |
| **P1 · Walking skeleton** | `short_explainer_v1` end to end, local CLI + local review UI + Supabase free | **3 videos** exported; founder time measured against a manual baseline | API only (< €2/video, re-check) |
| **P2 · Internal tool** | deploy, durable workflows, 16:9, private publishing, analytics sync, multi-channel | 10+ videos; first-pass approval ≥ 60%; time/video ≤ 45′ | Vercel/Supabase/Trigger plans: **UNKNOWN, re-check** |
| **P3 · Agency** | multi-workspace, roles, quotas, export presets | 1 external paying user (manual pilot) | + Remotion Company License if the team is > 3 people |
| **P4 · SaaS** | Stripe billing, onboarding, public API, R2 | willingness to pay validated | depends on P3 |

Licenses and platform (FACTS, accessed 2026-09-30):
- Remotion is free for individuals and teams of **up to 3 people, even for a commercial SaaS**. Above that, "Remotion for Automators" costs **$0.01/render, $100/month minimum** (remotion.dev/docs/license/faq and /docs/terms).
- YouTube Data API `videos.insert`: uploads from **unverified** API projects (created after 28/07/2020) are **forced to private** until the project passes an audit. The quota is now in a separate "Video Uploads" bucket (1 unit per call) (developers.google.com/youtube/v3/docs/videos/insert). → Start the audit early in P2.
- YouTube requires creators to disclose realistic content that was altered or generated with AI; the label is more visible on sensitive topics (blog.youtube, "Disclosing AI-generated content"). → `ai_disclosure` is a required field before publishing.

## 12. Risks
| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| **Scope creep vs Lilla** (two projects, one founder) | high | high | FD-005: shared core, one channel at a time |
| Building before proving demand (the SaaS) | high | high | P3 requires 1 paying user before we build billing |
| "Inauthentic content" → demonetization | medium | high | gates B/D required, similarity check, varied formats |
| LLM fact-check that "confirms" false claims | medium | high | ADR-08 quote verification in code; eval with planted false claims |
| Copyright (assets, music, third-party footage) | medium | high | ADR-06/07, license evidence required |
| Provider costs out of control | medium | medium | ADR-05 pre-flight cost guard + caps |
| Provider lock-in / price changes | medium | medium | ADR-04 adapters; at least 2 providers for TTS and images before P3 |
| YouTube API audit/quotas for the SaaS | medium | high (P4) | audit in P2; per-project upload quota |
| Remotion license when the team is > 3 | low (now) | medium | known cost: budget $100/month from P3 |
| Supabase free tier pauses inactive projects | high (P1) | low | acceptable in P1; paid plan in P2 |
| Kids content (if the factory serves Lilla) | medium | high | `made_for_kids` required; the Kids caption preset; separate rules |

## 13. Tests
| Level | What | Tool |
|---|---|---|
| Unit | Zod schemas, DAG state machine (allowed/forbidden transitions), cost estimator, idempotency key | Vitest |
| DB/RLS | every policy: cross-tenant read blocked, viewer can't write, **service role can't approve**, approved is immutable, cost ledger append-only | pgTAP (`supabase test db`) |
| Adapter contract | every provider adapter against recorded fixtures (no network in CI) | Vitest + fixtures |
| LLM evals | hooks (rubric), script (clichés and length), **fact-check: a set with planted false claims → recall ≥ 95% on FAIL**, fabricated quotes → 100% caught | eval harness + human labels |
| Golden render | frames sampled at fixed timestamps compared with a reference (tolerance) | Remotion `renderStill` + pixel diff |
| E2E | create project → run with mock providers → approve the gates → export | Playwright |
| Security | secret scan (the OS's existing `validate_assets.py`), dependency audit, RLS advisors | CI + Supabase advisors |

## 14. Folder structure (dedicated repo `content-factory`, NOT inside taste-skill)
```
content-factory/
├─ apps/
│  ├─ web/                 # Next.js: review UI + API route handlers
│  └─ worker/              # workflow tasks (DAG steps), media and render workers
├─ packages/
│  ├─ core/                # domain types, Zod schemas, DAG templates, state machine, cost guard
│  ├─ modules/             # strategy, research, factcheck, hooks, script, visual, metadata, qa
│  │  └─ <module>/         #   prompt.md · schema.ts · module.ts · evals/
│  ├─ providers/           # ports + adapters: llm, tts, stt, image, video, search, storage, youtube
│  ├─ render/              # Remotion compositions, caption presets, layout 9:16 / 16:9
│  └─ media/               # FFmpeg wrappers (loudness, mux, transcode, thumbnails)
├─ supabase/
│  ├─ migrations/          # SQL schema + RLS
│  └─ tests/               # pgTAP
├─ evals/                  # shared datasets (planted claims, hook rubric)
├─ docs/adr/               # ADR-01..10 in separate files
└─ .github/workflows/      # CI: lint, typecheck, unit, pgTAP, evals (fixtures), secret scan
```
Stack: pnpm workspaces + Turborepo, TypeScript strict, Zod, Vitest, Playwright.

## 15. Future improvements (not before P3)
Formats: 1:1 and 4:5 · multi-language (dubbing) · A/B testing of titles and thumbnails · a performance model trained on our own analytics (not on "viral" heuristics) · brand kits per channel · a template marketplace · a public API.

---
## Open questions (minimal, blocking)
1. **The rest of the spec** (after Agent 11 · Voice): which agents and constraints are missing?
2. **Which first channel** will the factory serve? (FD-005)
3. **Budget** for API usage in P1: is it separate from Lilla's €300? (FD-006)
4. **Dedicated repo** `content-factory`: the integration can't create repos (403) → the founder has to create it and give access.
