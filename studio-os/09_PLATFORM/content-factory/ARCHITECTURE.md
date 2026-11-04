# Content Factory — Architecture Proposal v0.2

> **Status:** PROPOSAL, awaiting founder approval (FD-006). **No new code until it's approved.**
> **Owner:** CEO / CTO agent · **Date:** 2026-09-30 · **Autonomy:** LEVEL 2 (PREPARE) · **Spend:** €0
> **Input:** founder's "Master System Prompt — AI YouTube Content Factory". The prompt was **cut off at Agent 11 (Voice)**. Anything after that point is UNKNOWN, and the parts of this doc that depend on it are marked `PENDING-SPEC`.
> **Context:** PROJECT M (preschool IP, D-004) is the approved business focus. **ClipForge** (`/clipforge`, Python, a local long-to-short clipper) already exists on this branch. The repo is **public** (D-003) → this doc contains no IP-sensitive material.

Claim labels follow `CLAUDE.md`: FACT (with source and date) · ESTIMATE · HYPOTHESIS · UNKNOWN.

---

## 0. Executive summary

1. **One engine, not a fourth codebase.** In 48 hours we've had Lilla → PROJECT M → ClipForge → Content Factory. The Content Factory is **the engine that unifies them**: ClipForge's core (step state, cache, LLM with structured output, whisper, `.ass` captions, ffmpeg, private YouTube publishing), generalized, with **pipeline templates**: `clip_v1` (ClipForge today), `preschool_episode_v1` (PROJECT M), `short_explainer_v1` (the master prompt: research + fact-check).
2. **Build a pipeline engine, not a "team of agents".** A fixed workflow runs the steps in a set order and decides what happens next. The LLM does the work that needs judgment and never controls the flow. Of the 11 agents in the spec, **6 are LLM modules** and **5 are ordinary code**.
3. **The real product is the data model:** versioned artifacts, each with a status, a record of where it came from, its cost and its rights. It stays the same from SQLite (local, P1) to Postgres/Supabase (P2+, multi-tenant).
4. **Humans approve; AI never does.** In P1 this is enforced in the review command's code; from P2 **in the database** (trigger + RLS): only a logged-in human with the reviewer role can set `approved`.
5. **Compliance first** (sources, rights, human approval) is the only differentiator worth testing in a crowded AI-video market. It's a HYPOTHESIS (A-10), not a plan.
6. **Scope:** the recommendation (FD-007) is that the engine's first user be **PROJECT M**. It's already in the roadmap ("week 3: pipeline code + tests"), so it adds no new work. The research and fact-check modules come in when a factual channel exists.

---

## 1. Real objective
Cut **founder minutes per published video** while keeping the editorial quality high enough to stay monetizable. Secondary goal: create a reusable asset (the platform) that might later be sold.

| Metric | Definition | Target (HYPOTHESIS) |
|---|---|---|
| Founder time / video | minutes of human work from idea to export | ≤ 45 min (Short) after P1 |
| First-pass approval rate | % of artifacts approved without regeneration, per module | ≥ 60% |
| Cost / finished minute | € in API + infra / published minutes | tracked; ceiling set per run |
| Fact-check escape rate | false claims found after approval | 0 tolerated → incident |
| Relative retention | vs the channel's own baseline | from the 4th video onward |

## 2. Problem to solve
- **Production is not yet proven to be the bottleneck** (A-11): no video has been published. Automating an unknown process locks in the wrong process → the factory is **extracted from real production** (PROJECT M's MVP), not designed in a vacuum.
- Solo founder: every human gate costs time. Too many gates → the tool isn't used; too few → quality and compliance collapse.
- **Focus:** four initiatives in two days, €0 of revenue, 0 videos. The biggest risk isn't technical.
- Platform (FACT, YouTube Help "Channel monetization policies", accessed 2026-09-30): *"July 15, 2025: … renaming this policy from 'repetitious content' to 'inauthentic content' … must not be mass-produced, generic, repetitive"*. A spam factory is a monetization risk by design.

## 3. Simplest solution (P1, €0 of infra)
- **Extend ClipForge in Python** into a generic `factory` package: we reuse `db` (jobs/steps, idempotency), `cache`, `llm/base` (structured output + retry on validation errors), `transcribe` (word timestamps), `captions` (.ass karaoke), `ffmpeg` (loudnorm −14 LUFS), `publish/youtube`, `report.html`.
- **Local SQLite** with the logical schema from §6 (same tables and fields) → migrating to Postgres in P2 is mechanical.
- **Review without building a UI:** a static `review.html` (the pattern ClipForge already uses) + the CLI `factory review <artifact> approve|revise|reject -m "…"`.
- **Composition with ffmpeg** (images/clips + zoom/pan + xfade + VO + captions), consistent with ClipForge and the Assembler agent (10).
- Cost: API only. ESTIMATE < €2 per Short (LLM + TTS + a few images). **Re-check pricing before any spend.**

## 4. Most scalable solution (target at 100k users)
- **Data:** Supabase: Postgres + RLS, Auth, Realtime (run progress), Storage. Move media to Cloudflare R2 when egress becomes the main cost (ESTIMATE).
- **Workers:** stateless Python in containers (Cloud Run / Fly / Railway: UNKNOWN costs, re-check) reading from a **Postgres queue** (Supabase Queues / pgmq). No new vendor. HYPOTHESIS to validate with a spike in P2; the alternative is a durable engine with a Python SDK (e.g. Inngest).
- **Web:** Next.js on Vercel for the review UI and the API (P2); it talks only to Supabase and to the queue.
- **Render farm:** ffmpeg workers with concurrency limits per plan. Remotion only if we need motion graphics that ffmpeg can't do (see ADR-09).
- **Multi-tenant:** `workspace_id` on every row; RLS everywhere; quotas and budget caps per workspace.

## 5. Architecture

### 5.1 Decisions (ADR summary)
| # | Decision | Why |
|---|---|---|
| ADR-01 | The orchestrator is a **deterministic DAG per template**, not an LLM | reproducible, debuggable, cheap; stops conflicting overwrites |
| ADR-02 | Every output is an **immutable, versioned artifact** (append-only); an edit creates a new version | traceability, diffs, no destructive overwrites |
| ADR-03 | **Only humans approve** (P1 in code, P2+ in the DB) | spec §4 "Never pretend that an AI-generated result is correct" |
| ADR-04 | **Ports and adapters** for every provider (LLM, TTS, STT, image, video, search, storage, publish) | swap providers without touching the pipeline; tests with fixtures |
| ADR-05 | **Pre-flight cost guard:** estimate → check against the run and workspace budget → reserve → call → reconcile | no surprise bills; OS rule "no generation loops" |
| ADR-06 | **Rights ledger:** every asset has a `rights_status`; rendering or publishing is **blocked** if any asset is `unknown`, or `third_party` without a license | spec §4 copyright safety |
| ADR-07 | **A third-party URL is reference only**: metadata via the official API; no download of third-party media. Downloading is allowed only for content the user declares `user_owned` or `licensed` | FACT (YouTube ToS, accessed 2026-09-30): you may not *"access, reproduce, download … any Content except (a) as expressly authorized by the Service; or (b) with prior written permission"* |
| ADR-08 | **Quote-grounded fact-check:** a verdict cites an exact passage from the stored source snapshot; code checks that the passage really exists | stops an LLM from "confirming" a claim with an invented quote |
| ADR-09 | **ffmpeg + libass** for composition in P1–P2; **Remotion** only if a measured need appears | one stack (Python), reuses ClipForge. Remotion license (FACT, remotion.dev license FAQ, accessed 2026-09-30): free for teams of up to 3 people, even for a SaaS; otherwise **$0.01/render, $100/month minimum** |
| ADR-10 | **Idempotent steps** (`idempotency_key = hash(step, inputs, prompt_version, model)`) | safe retries; cache (ClipForge already does this) |
| ADR-11 | **Templates, not forks:** clip / preschool / explainer share the same modules; a template only declares its DAG, gates and QA rules | three use cases, one piece of code to maintain |

### 5.2 Components
```
          P1: CLI + review.html (local)          P2+: Next.js review UI
                        │                                  │
                        ▼                                  ▼
             ┌─────────────────────────────────────────────────────┐
             │ Store: SQLite (P1)  ⇄  Postgres/Supabase + RLS (P2) │  single source of truth
             └──────────────┬──────────────────────────────────────┘
                            │ runs / steps / artifacts / reviews
                  ┌─────────▼──────────┐
                  │ Orchestrator (DAG) │  templates: clip_v1 · preschool_episode_v1 · short_explainer_v1
                  └─────────┬──────────┘
      ┌───────────────┬─────┴─────────┬────────────────┬──────────────────┐
      ▼               ▼               ▼                ▼                  ▼
  LLM modules    Provider ports   Media (ffmpeg)    QA / rights       Publish + analytics
 strategy·research LLM·TTS·STT·    compose·captions  checks·ledger     YouTube Data (private)
 factcheck·hooks   image·search    loudnorm·reframe  similarity        + Analytics API
 script·visual                     (from ClipForge)
```

### 5.3 Map from the spec's agents to modules
| Spec agent | Implementation | LLM? | Reuse |
|---|---|---|---|
| 1 Orchestrator | DAG engine + templates | ❌ | extends `clipforge/pipeline.py` (`_step`, resume) |
| 2 Strategy + 5 Content Strategist | `strategy.brief` (angle, promise, retention, CTA) | ✅ | new; split into two only if evals say so |
| 3 Research | `research.dossier` + stored source snapshots | ✅ + search/fetch | new |
| 4 Fact Check | `factcheck.claims` PASS/WARNING/FAIL, corrections recorded | ✅ + code | new |
| 6 Script | `script.write` (N variants) | ✅ | new; PROJECT M uses `episode.schema.json` |
| 7 Hook | `hooks.generate` (8 types, 5-criteria rubric) | ✅ | ClipForge's `hook_title` as a base |
| 8 Visual Director | `visual.plan` (scene JSON per spec §8) | ✅ | new |
| 9 Video Editor | `media.compose` (ffmpeg) | ❌ | `clipforge/render.py`, `ffmpeg.py` |
| 10 Caption | `media.captions` + presets (Bold/Minimal/Creator/Podcast/Documentary/Kids) | ❌ | `clipforge/captions.py` |
| 11 Voice | TTS port; word timestamps from the provider or from whisper on the audio | ❌ | `clipforge/transcribe.py` for alignment |
| 12+ | QA, Metadata/SEO, Thumbnail, Publish, Analytics… | mixed | `PENDING-SPEC` · QA §9 · `clipforge/publish` |

### 5.4 Template `short_explainer_v1` (the master prompt's use case)
```
intake ─▶ strategy.brief ─▶ research.dossier ─▶ factcheck(dossier)
                         [GATE A · brief + dossier]            (optional, ON at the start)
hooks.generate ∥ script.write ─▶ factcheck(script) ─▶ similarity vs the channel's past scripts
                         [GATE B · hook + script + fact report] (REQUIRED)
voice.tts ─▶ align (word timestamps) ─▶ scene_plan (timed) ─▶ visual.plan ─▶ assets (per scene, rights assigned)
                         [GATE C · visual plan + assets]        (optional, ON at the start)
captions ─▶ compose 9:16 ─▶ metadata ∥ thumbnail concept ─▶ qa.report
                         [GATE D · final approval]              (REQUIRED)
export package ─▶ (P2) publish PRIVATE ─▶ founder makes it public with one click (D-004)
```
- `preschool_episode_v1`: no research/fact-check; **QC & Child Safety (agent 09)** as a required gate; `made_for_kids = true`; the Kids caption preset; pacing checks.
- `clip_v1`: ClipForge's current flow + an **ingest rights gate** (ADR-07) + GATE D before publishing.
- Gates A and C are switched off when that module's first-pass approval rate is ≥ 80% over 10 runs (a measured decision). `needs_revision` → a new version with the reviewer's comment as input.

### 5.5 LLM layer
- **Port** with adapters. Available today in ClipForge: Ollama (local, default), Gemini, Groq. To add: **Anthropic**.
- Per-module default (proposal): **`claude-opus-5-5`** for the judgment modules (strategy, research, fact-check, script). Using cheaper or local models on a module is **the founder's decision after an eval** showing no quality loss. A 7B local model is not a sound choice for fact-checking (HYPOTHESIS to measure with the §13 eval).
- Anthropic features that are useful here (reference docs checked 2026-09-30): **structured outputs** (`output_config.format`, JSON Schema) re-validated with pydantic; server tools **`web_search_20260209` / `web_fetch_20260209`** for research (we save our own snapshots); **citations** on documents for fact-checking. ⚠️ FACT: citations **aren't compatible** with `output_config.format` → 2 steps (a cited check, then JSON normalization). **Prompt caching** on stable prompts and rubrics; the **Batch API (−50%)** for anything not urgent.
- Versioned prompts (the `prompts` table); every call logged to `provider_calls` with its tokens and cost.

## 6. Database (logical; SQLite in P1, Postgres/Supabase from P2)
```sql
-- Enums (P2: Postgres types; P1: CHECK constraints)
member_role     = owner | editor | reviewer | viewer
artifact_status = generated | reviewed | approved | rejected | needs_revision
rights_status   = user_owned | licensed | public_domain | third_party | unknown
check_verdict   = pass | warning | fail
run_status      = queued | running | waiting_review | succeeded | failed | cancelled

-- Tenancy (P2; in P1 a single implicit workspace)
workspaces        (id, name, plan, monthly_budget_cents, created_at)
workspace_members (workspace_id, user_id, role, pk(workspace_id,user_id))
channels          (id, workspace_id, platform, name, external_id, language, audience,
                   made_for_kids bool, brand_preset json, caption_preset)

-- Production
projects          (id, workspace_id, channel_id, template, title,
                   input_type ('topic'|'idea'|'url'|'youtube_url'|'video'|'episode_json'),
                   input json, input_rights rights_status, format ('short'|'long'),
                   target_audience, budget_cap_cents, created_by, created_at)
artifacts         (id, workspace_id, project_id, kind, version, parent_id, status,
                   content json, storage_path, produced_by ('module:<key>@<ver>'|'human'),
                   prompt_id, provider, model, input_hash, cost_cents, created_at,
                   unique(project_id, kind, version))
                   -- kind: brief|research_dossier|fact_report|hooks|script|voiceover|scene_plan|visual_plan|
                   --       captions|video|titles|description|tags|thumbnail_concept|qa_report|clip
artifact_reviews  (id, workspace_id, artifact_id, reviewer_kind ('human'|'automated'), reviewer_id,
                   from_status, to_status, comment, created_at)          -- append-only

-- Evidence
sources           (id, workspace_id, project_id, url, title, publisher, published_at, accessed_at,
                   relevance 0..100, snapshot_path, content_sha256, rights_status)
claims            (id, workspace_id, project_id, artifact_id, text,
                   claim_type ('fact'|'statistic'|'quote'|'opinion'), verdict, rationale,
                   evidence json,      -- [{source_id, quote, quote_verified}]
                   correction json)    -- {from, to, reason}: never silent

-- Media & rights
assets            (id, workspace_id, project_id, kind ('image'|'video'|'audio'|'music'|'font'),
                   origin ('generated'|'stock'|'upload'|'screen_recording'|'ingest'),
                   storage_path, sha256, rights_status,
                   license json,       -- {licensor, license_url, evidence_path, expires_at}
                   provider, prompt, created_at)

-- Execution (generalizes ClipForge's jobs/steps)
pipeline_runs     (id, workspace_id, project_id, template, status, current_step,
                   budget_cap_cents, spent_cents, started_at, finished_at, error)
run_steps         (id, workspace_id, run_id, step_key, status, attempt, output_artifact_id,
                   idempotency_key unique, error, started_at, finished_at)
provider_calls    (id, workspace_id, run_id, step_id, provider, model, operation, units json,
                   cost_cents, latency_ms, status, created_at)   -- append-only; P2 partitioned by month
renders           (id, workspace_id, project_id, artifact_id, aspect ('9:16'|'16:9'),
                   width, height, status, output_path, duration_ms, render_ms, created_at)

-- Distribution & learning
publications      (id, workspace_id, project_id, channel_id, render_id, platform, external_id,
                   visibility, ai_disclosure bool, made_for_kids bool, approved_by, published_at)
metric_snapshots  (id, workspace_id, publication_id, captured_at, views, avg_view_duration_s,
                   avg_view_pct, likes, comments, subs_gained, raw json)
prompts           (id, module, version, template, output_schema json, is_active, created_at)
```
Scaling to 100k users (P2+): `workspace_id` denormalized onto every table (RLS without joins) · indexes `(workspace_id, created_at desc)`, `(project_id, kind, version desc)` · `provider_calls` and `metric_snapshots` partitioned by month · media content-addressed (sha256) plus lifecycle rules for intermediate renders · no heavy work inside HTTP requests or DB transactions.

## 7. Supabase RLS policies (P2, draft)
```sql
create function private.has_role(ws uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = any(roles));
$$;

-- Reads: any member (same pattern on every tenant table)
create policy read_member on public.projects for select to authenticated
  using (private.has_role(workspace_id, '{owner,editor,reviewer,viewer}'));
-- Project writes: owner/editor
create policy write_projects on public.projects for insert to authenticated
  with check (private.has_role(workspace_id, '{owner,editor}'));

-- Artifacts: no direct writes from clients
revoke insert, update, delete on public.artifacts from authenticated, anon;
-- public.review_artifact(id, to_status, comment)  security definer:
--   approved|rejected → owner|reviewer ; needs_revision → owner|editor|reviewer ; validates the transition; writes artifact_reviews
-- public.revise_artifact(id, content) → new version, produced_by='human'
-- Guard trigger (also applies to the service role):
--   approved/rejected are terminal · status→'approved' requires auth.uid() IS NOT NULL (a human session) → workers can't approve

-- Costs: owners can read; append-only; writes only from the service role (workers)
create policy read_costs on public.provider_calls for select to authenticated
  using (private.has_role(workspace_id, '{owner}'));
revoke insert, update, delete on public.provider_calls from authenticated, anon;

-- Storage: private bucket 'media', path <workspace_id>/<project_id>/...
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,editor,reviewer,viewer}'));
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,editor}'));
```
`service_role` only in the workers (as a secret in the runtime, never in the client or the repo) · short-lived signed URLs for playback · uploads require a rights declaration · provider webhooks verified with HMAC · `prompts` can be read by authenticated users and written only by migration.

## 8. API
**P1 (CLI, same functions):** `factory new --template … --input …` · `factory run <project>` · `factory status` · `factory review <artifact> approve|revise|reject -m` · `factory export <project>` · `factory publish <render> --privacy private`.

**P2 (HTTP):**
| Method | Path | Role | Effect |
|---|---|---|---|
| POST | `/api/projects` | editor | creates the project; `input_rights` required; `youtube_url` of a third party → reference only |
| POST | `/api/projects/:id/runs` | editor | starts the DAG `{template, budget_cap_cents}` |
| GET | `/api/runs/:id` | viewer | status + steps (live via Realtime) |
| POST | `/api/runs/:id/cancel` | editor | cancels; keeps the logs |
| POST | `/api/artifacts/:id/review` | reviewer | RPC `review_artifact` → resumes the DAG |
| POST | `/api/artifacts/:id/regenerate` | editor | new version with instructions (cost guard) |
| PATCH | `/api/artifacts/:id` | editor | human edit → new version |
| POST | `/api/assets/upload-url` | editor | signed URL; `rights_status` + license required |
| GET | `/api/projects/:id/export` | viewer | zip: mp4, srt/ass, metadata.json, sources.json, qa_report.json |
| POST | `/api/publications` | owner | only with the render approved + QA not FAIL; default `private` |
| POST | `/api/webhooks/:provider` | — | HMAC, idempotent |

Module contract (spec): `Module[I,O] = {key, version, input_model, output_model (pydantic), estimate_cost(I), run(I, ctx) -> O}`. `ctx` exposes providers, budget, logger and storage. **Modules have no access to the DB.**

## 9. UI (review first)
P1: `review.html` with every artifact, its status and version, the fact table (claim → verdict → highlighted quote → snapshot), a preview of the renders and rights badges (red if `unknown`), plus the `factory review …` command to copy.
P2: Projects → project workspace (DAG stepper · active artifact · versions/diff/cost · Approve / Revise / Reject + comment) → fact panel → timeline preview → QA and export. **Mobile approval** as a priority (the founder has little time).

QA report (deterministic checks + LLM): claims PASS or an accepted WARNING · no `unknown` rights · captions inside the 9:16 safe zones, minimum size · duration within the Shorts limit (re-check the current limit) · loudness ≈ −14 LUFS (ESTIMATE) · AI-disclosure and made-for-kids flags decided · **similarity to the channel's recent scripts** below a threshold (defends against "inauthentic content") · no banned phrases or clichés · for preschool: pacing and child-safety rules (agent 09).

## 10. Automations
- Retries (max 2, backoff) **only for transient errors**; a validation failure → `needs_revision`, never an infinite retry.
- Cost guard per run and per workspace per month; a kill switch (`EMERGENCY_STOP` in `08_AUTOMATION/configs/autonomy.yml` in P1, workspace + global flags in P2) checked before every step.
- Notifications "gate waiting" / "run failed" (P2).
- Nightly analytics sync (YouTube Analytics API) → `metric_snapshots` → a weekly report comparing retention with the baseline.
- Weekly **learning loop**: approval rate and reasons for rejection per module → prompt changes proposed as a PR, approved by a human.
- ClipForge's `watch`: only on **the founder's own or authorized** channels (ADR-07).

## 11. Roadmap (gated, aligned with `00_CORE/roadmap.md`)
| Phase | Content | Exit criterion | Cost (ESTIMATE) |
|---|---|---|---|
| **P0 · Spec** (now) | this doc + the complete spec + FD-006…FD-010 | decisions closed | €0 |
| **P1 · Engine** (= PROJECT M roadmap week 3) | `factory` package from ClipForge; templates `preschool_episode_v1` + `clip_v1`; SQLite; CLI + review.html | **3 videos** exported; founder time measured against a manual baseline | API only (< €2/video, re-check) |
| **P1b · Explainer** | research + fact-check modules, template `short_explainer_v1` | fact-check eval passed (§13) | API only |
| **P2 · Internal tool** | Supabase, Python workers + queue, web review UI, 16:9, private publishing, analytics, multi-channel | 10+ videos; first-pass approval ≥ 60%; time/video ≤ 45′ | plans: **UNKNOWN, re-check** |
| **P3 · Agency** | multi-workspace, roles, quotas, export presets | **1 external paying user** (manual pilot) | + Remotion license only if adopted and the team is > 3 people |
| **P4 · SaaS** | Stripe billing, onboarding, public API, R2 | willingness to pay validated | depends on P3 |

Platform FACTS (accessed 2026-09-30):
- YouTube Data API `videos.insert`: uploads from **unverified** API projects (created after 28/07/2020) are **forced to private** until the project passes an audit; the quota is in a separate "Video Uploads" bucket (1 unit per call) (developers.google.com/youtube/v3/docs/videos/insert). → Start the audit in P2.
- YouTube requires creators to disclose realistic content that was altered or generated with AI (blog.youtube, "Disclosing AI-generated content") → `ai_disclosure` is a required field before publishing.

## 12. Risks
| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| **Scattered focus** (4 initiatives in 48 h, 0 videos) | high | high | one engine, one template at a time; FD-007 |
| Building the SaaS before proving demand | high | high | P3 requires 1 paying user before billing |
| **ClipForge: download (yt-dlp) and `watch` of third-party content** | high if used on third-party content | high (ToS + copyright) | ADR-07: a required rights gate at ingest; `watch` limited to owned or licensed channels (FD-010) |
| **ClipForge: "viral score"** conflicts with the spec ("never claim virality") | certain | low | rename it to `rank_score` (LLM estimate) in the UI and metadata (FD-010) |
| "Inauthentic content" → demonetization | medium | high | gates B/D required, similarity check, varied formats |
| LLM fact-check "confirms" false claims | medium | high | ADR-08 + an eval with planted false claims |
| Copyright of assets and music | medium | high | ADR-06, license evidence required |
| Provider costs / lock-in | medium | medium | ADR-04/05; at least 2 providers for TTS and images before P3 |
| YouTube API audit/quota for the SaaS | medium | high (P4) | audit in P2 |
| Kids content (PROJECT M) | medium | high | template with `made_for_kids`, required agent-09 gate |
| Public repo | certain | medium | code and doc here contain no IP; the factory code goes into a dedicated repo (FD-009) |

## 13. Tests
| Level | What | Tool |
|---|---|---|
| Unit | pydantic schemas, DAG state machine (allowed/forbidden transitions), cost guard, idempotency key, rights gate | pytest (ClipForge already uses it) |
| DB/RLS (P2) | cross-tenant read blocked, viewer can't write, **service role can't approve**, approved is immutable, cost ledger append-only | pgTAP (`supabase test db`) |
| Adapter contract | every provider against recorded fixtures (no network in CI) | pytest + fixtures |
| LLM evals | hooks (rubric), script (clichés and length), **fact-check: planted false claims → recall ≥ 95% on FAIL; fabricated quotes → 100% caught** | eval harness + human labels |
| Golden render | frames sampled at fixed timestamps compared with a reference (tolerance) | ffmpeg + pixel diff |
| E2E | new → run with mock providers → gate approvals → export | pytest (P1), Playwright (P2 web) |
| Security | secret scan (`validate_assets.py`), dependency audit, Supabase advisors | CI |

## 14. Folder structure (dedicated repo `content-factory`, FD-009)
```
content-factory/
├─ factory/
│  ├─ core/        # pydantic models, DAG + templates, state machine, cost guard, rights ledger
│  ├─ store/       # repositories: sqlite (P1) · postgres (P2), same interface
│  ├─ modules/     # strategy · research · factcheck · hooks · script · visual · metadata · qa
│  │  └─ <module>/ #   prompt.md · schema.py · module.py · evals/
│  ├─ providers/   # llm (anthropic, ollama, gemini, groq) · tts · stt (faster-whisper) · image · search · youtube
│  ├─ media/       # ffmpeg · captions (.ass) · compose · loudnorm · reframe   ← from ClipForge
│  └─ pipelines/   # clip_v1 · preschool_episode_v1 · short_explainer_v1
├─ web/            # P2: Next.js review UI (Supabase)
├─ supabase/       # migrations/ + tests/ (pgTAP)
├─ evals/          # shared datasets (planted claims, hook rubric)
├─ tests/
└─ docs/adr/       # ADR-01..11
```

## 15. Future improvements (not before P3)
Formats: 1:1 and 4:5 · dubbing and multi-language (ClipForge's `translate` as a base) · A/B testing of titles and thumbnails · a performance model trained on our own analytics · brand kits per channel · a public API.

---
## Open questions (minimal, blocking)
1. **The rest of the spec** after Agent 11 (Voice).
2. **The engine's first template** (FD-007).
3. **API budget** for P1 (FD-008).
4. **Dedicated repo** `content-factory` (FD-009): the integration can't create repos (403).
