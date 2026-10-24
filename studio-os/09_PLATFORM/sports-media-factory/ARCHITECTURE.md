# Sports Media Factory — Architecture Proposal v0.1

> **Status:** PROPOSAL, awaiting founder approval (FD-012…FD-016). **No new code until it's approved.**
> **Owner:** CEO / CTO agent · **Date:** 2026-10-08 · **Autonomy:** LEVEL 2 (PREPARE) · **Spend:** €0
> **Input:** founder's "Sports Media Factory — Master Orchestrator" prompt (complete, 10 agents, Opportunity Score formula).
> **Companion docs:** [`SCORING.md`](SCORING.md) (rubric, gates, tiers) · [`radar/2026-10-07.md`](radar/2026-10-07.md) (pilot Daily Sports Radar, produced by hand with this rubric).
> **Builds on:** [`../content-factory/ARCHITECTURE.md`](../content-factory/ARCHITECTURE.md) v0.2. Everything there (DAG engine, versioned artifacts, human-only approval, rights ledger, quote-grounded fact-check, cost guard, RLS pattern) is reused, not redesigned.

Claim labels follow `CLAUDE.md`: FACT (with source and date) · ESTIMATE · HYPOTHESIS · UNKNOWN.

---

## 0. Executive summary

1. **This is the 6th initiative in 10 days** (Lilla → PROJECT M → ClipForge → Content Factory → Cutroom → Sports). €0 revenue, 0 videos published. The biggest risk is still focus, not technology. The proposal is shaped around that: **no new codebase, a 14-day manual pilot first, explicit kill criteria.**
2. **Sports = a template on the Content Factory engine** (`sports_short_v1`) plus **one new subsystem: the Radar** (signals → opportunities → score → tier). The 10 agents in the prompt map to 4 deterministic jobs and 6 LLM modules, most of which already exist in the Content Factory design.
3. **Rights are a gate, not a 5% weight.** With the prompt's formula, a straight re-upload of the Medvedev incident footage (RED, zero originality) still scores **52 → B-TIER** (see `SCORING.md` §4). The formula is kept as written; hard gates sit on top of it.
4. **Brand by format, not by sport.** Monitor 17+ sports, publish one recognizable format: *"the number / the rule / the record behind the moment"*, built from original graphics, data and voice, **no match footage**. Footage-free is not a limitation, it is the positioning: big accounts with rights win on clips; we win on explanation and speed of analysis.
5. **Speed comes from the calendar, not from reacting.** The most reliable "about to go viral" signal is a scheduled event with a known stake (a title that can be clinched, a debut, a record within reach). The Radar pre-produces those stories *before* the moment and publishes within minutes of it.
6. **Learning loop from day 1:** every published piece stores its predicted score; actual performance is compared at 24 h / 7 d; weights are re-fitted only by a reviewed PR, never automatically.

---

## 1. Real objective
Build a **recognizable, monetizable sports media brand** with the least founder time per published piece. Not "many videos": a format people subscribe to.

| Metric | Definition | Pilot target (HYPOTHESIS) |
|---|---|---|
| Radar → publish lead time | minutes from trigger event to a published Short (pre-built stories) | ≤ 30 min |
| Founder time / Short | human minutes, idea → upload | ≤ 40 min |
| Score calibration | Spearman ρ between predicted score and 7-day views (≥ 20 Shorts) | ρ ≥ 0.3 (else the rubric is noise) |
| Relative retention | avg % viewed vs the channel's own median | top-quartile pieces ≥ 1.3× median |
| Subscriber conversion | subs gained / 1,000 views | tracked; baseline after 20 Shorts |
| QC escapes | factual or rights errors found after publishing | 0 tolerated → incident |

## 2. Problem to solve
- **Footage rights.** Leagues and broadcasters actively enforce rights on match footage (HYPOTHESIS based on common practice; re-check each league's policy before any use). A channel built on clips is one claim-wave away from zero. → RED by default, see §5 ADR-S3.
- **Inauthentic content.** FACT (YouTube Help, "Channel monetization policies", accessed 2026-09-30, from D-006): the policy was renamed from "repetitious" to "inauthentic content" on 2025-07-15; content *"must not be mass-produced, generic, repetitive"*. A high-volume AI-voice sports-news channel is exactly that risk. → quality over quantity, human voice or strong editorial identity, similarity check (Content Factory §9).
- **Speed vs. giants.** Official league channels and large media publish highlights in minutes. Competing on reaction speed with footage is unwinnable. Competing on *prepared* analysis of *predictable* moments is winnable.
- **Fact risk is real, measured today.** During the pilot radar a search summary asserted "Spain beat Croatia 2-1 in the Nations League quarter-finals, Merino winner". Primary reports show a **4-1 league-phase win on 2026-09-29** (ESPN, Al Jazeera); Merino scored against the Czech Republic instead. → the Fact Check gate is not optional (see `radar/2026-10-07.md` §QC log).
- **Breadth vs. brand.** 17 sports × daily output = no recognizable identity and an impossible workload for one founder.

## 3. Simplest solution (pilot, €0, no code) — RECOMMENDED FIRST
**14-day manual pilot** that tests the only thing that matters: does this format earn attention and subscribers?
- **Daily Radar** produced by Claude (this doc's rubric) from free sources: web search, the sports calendar, official standings pages, vidIQ (already connected) for YouTube velocity. Output: `radar/YYYY-MM-DD.md`, committed. ~15 min of founder review.
- **1 Short per day, max**, only S/A-tier, only GREEN formats: original graphics (standings bars, countdowns, record timelines), founder voice-over, captions. Built with **Cutroom** (already exists) or a slide-to-video template. No new code.
- **Manual publish**, manual metrics in a CSV (`06_ANALYTICS/sports/pilot-log.csv`, created when the pilot starts).
- Optional: a **Claude Routine** (scheduled cloud session, no code) runs the Radar every morning at 07:45 Europe/Rome and commits the file. Needs founder approval (it is an automation).

**Kill / continue criteria at day 14 (proposal):** continue to P1 only if ≥ 10 Shorts published, ≥ 1 Short ≥ 3× channel median views, ρ(predicted, actual) > 0, and founder time ≤ 60 min/Short. Otherwise: stop, log the learning, return focus to PROJECT M.

## 4. Most scalable solution (target: 100k users / many channels)
Same as Content Factory §4 (Supabase + RLS, Python workers on a Postgres queue, Next.js review UI on Vercel, R2 when egress dominates), plus:
- **Signal ingestion workers** per source with per-source rate limits and caching; raw signals in a partitioned table; scoring is a pure function over a signal snapshot (reproducible, testable).
- **Multi-tenant radar:** each workspace defines its own sports, markets and languages; the global signal store is shared (read-only, public data) while opportunities, scores and productions are tenant-scoped.
- **Scoring model versioning:** `scoring_models` table; every opportunity stores the model version that scored it, so recalibration never rewrites history.

## 5. Architecture

### 5.1 Decisions (ADR summary, sports-specific; ADR-01…11 from Content Factory still apply)
| # | Decision | Why |
|---|---|---|
| ADR-S1 | **Radar is a deterministic job + one LLM module**: code collects signals and computes scores; the LLM only proposes angles and fills qualitative sub-scores with written reasons | reproducible scores; the LLM cannot inflate a number without a stated reason |
| ADR-S2 | **Hard gates override the score**: RED rights → IGNORE; core claim unverified → HOLD; brand-fit fail → IGNORE | prompt says RED must not be produced; a 5% weight can't enforce that (`SCORING.md` §4) |
| ADR-S3 | **Match/broadcast footage = RED by default.** GREEN = own graphics, data viz, own voice, licensed stock, official press material whose terms allow reuse, CC licenses compatible with commercial use (BY / BY-SA; not NC/ND). YELLOW = anything that needs a license check | rights-first; consistent with Content Factory ADR-06/07 |
| ADR-S4 | **Calendar-first radar**: scheduled events with a stake are scored ahead of time and get a *pre-built story* (script + graphics with placeholders) | speed without footage; "what is about to go viral" becomes a planning problem |
| ADR-S5 | **Brand by format**: one visual system, one voice, one recurring structure (hook number → why it matters → context → payoff) across all sports | recognizability; defends against "inauthentic content" |
| ADR-S6 | **Data-source tiers**: official league/federation pages and APIs > licensed data APIs > reputable outlets > aggregators; aggregator-only facts are never published | the pilot found conflicting figures on aggregator pages (MotoGP, UFC, NFL) |
| ADR-S7 | **Prediction ledger**: predicted score + sub-scores frozen at decision time; outcomes appended later; recalibration is a PR | the learning loop needs untouched predictions |

### 5.2 Pipeline (agents → modules)
```
  CALENDAR + SIGNALS (cron)                                  ┌──────────── LEARNING LOOP ───────────┐
  ─────────────────────────                                  │                                      │
  01 Sports Radar   [code]  events, results, standings ─┐    │                                      │
  02 Trend Hunter   [code]  YouTube VPH, Wikipedia     ─┼─▶ signals ─▶ opportunities ─▶ SCORE ─▶ TIER│
                            pageviews, search trends   ─┘              (LLM angle +    (code)  gates │
                                                                         reasons)                    │
                                         [GATE R · founder picks from TOP 10]  ◀─────────────────────┤
  03 Research & Fact Check [LLM+code]  dossier + quote-verified claims (Content Factory ADR-08)      │
  05 Hook   ∥   04 Story/Script [LLM]  N hooks (rubric) · script in the brand structure              │
                                         [GATE B · script + facts + rights]  (REQUIRED)              │
  06 Editor    [code]  voice (founder or TTS) → captions → compose 9:16 (Cutroom / ffmpeg)           │
  07 Thumbnail [LLM+code] concept + render from brand template                                       │
  08 QC        [code+LLM] 11-point checklist (§9); any critical FAIL → DO NOT PUBLISH                │
                                         [GATE D · final approval]  (REQUIRED, human)                │
  09 Publishing [code]  upload (private → founder makes public) · metadata · AI disclosure           │
  10 Analytics  [code]  24 h / 7 d / 28 d snapshots → prediction ledger ─────────────────────────────┘
```
Pipeline, not swarm: each agent runs only when the previous artifact is approved or the gate is auto-passed. Agents 03–09 run **only for opportunities the founder selected**, so most days only 01, 02 and the scoring step run.

### 5.3 Map to Content Factory modules
| Prompt agent | Module | LLM? | Status |
|---|---|---|---|
| 1 Sports Radar | `radar.collect_events` (calendar, results, standings) | ❌ | new (sports-specific adapters) |
| 2 Trend Hunter | `radar.collect_signals` (velocity, pageview acceleration) + `radar.angle` | ❌ + ✅ | new |
| — Scoring | `radar.score` (pure function, `SCORING.md`) | ❌ | new |
| 3 Research & Fact Check | `research.dossier` + `factcheck.claims` | ✅ | Content Factory (reused) |
| 4 Story/Script | `script.write` with the sports brand structure | ✅ | reused, new prompt |
| 5 Hook | `hooks.generate` | ✅ | reused |
| 6 Editor | `media.compose` / Cutroom | ❌ | reused |
| 7 Thumbnail | `thumbnail.concept` + template render | ✅ + ❌ | Content Factory `PENDING-SPEC` → specified here |
| 8 QC | `qa.report` + sports checklist | mixed | reused + extended |
| 9 Publishing | `publish.youtube` (private) | ❌ | ClipForge/Content Factory |
| 10 Analytics | `analytics.sync` + `radar.calibrate` | ❌ | reused + new calibration |

### 5.4 Signal sources (to verify in a spike before any code; all UNKNOWN until checked)
| Signal | Candidate source | Why | Check before use |
|---|---|---|---|
| Schedule, results, standings | official league/federation sites; free tiers of sports data APIs | stakes and timeliness | ToS for commercial use, rate limits, cost |
| YouTube velocity | YouTube Data API (`videos.list chart=mostPopular`, Sports category) · vidIQ (connected) | what is accelerating now | quota; vidIQ credits (5/call). Pilot call 2026-10-07 returned 0 results for a generic multi-sport query → needs narrower queries |
| Interest acceleration | Wikimedia Pageviews REST API (`/metrics/pageviews/per-article`, `/top`) | leading indicator for people/events | data lag (a wrapper reports 1–2 days; verify on wikimedia.org) |
| Search interest | Google Trends | demand vs. supply | official API availability and terms |
| Community heat | Reddit / X | early controversy detection | API terms and cost — likely skip in pilot |

## 6. Database (adds to Content Factory §6; same conventions: `workspace_id` everywhere, append-only ledgers)
```sql
-- Enums
rights_light   = green | yellow | red
opp_tier       = s | a | b | ignore | hold
signal_kind    = result | standing | schedule | yt_velocity | pageviews | search_trend | social | news

-- Global, public data (no workspace_id; read-only to tenants)
sports            (id, slug, name, active bool)
competitions      (id, sport_id, slug, name, season, official_url)
events            (id, competition_id, kind ('match'|'race'|'fight'|'transfer'|'statement'|'record'|'other'),
                   title, starts_at, status ('scheduled'|'live'|'final'), stake text, source_url, fetched_at)
entities          (id, kind ('athlete'|'team'|'league'), name, wikidata_id, country)
signals           (id, kind signal_kind, event_id null, entity_id null, value numeric, baseline numeric,
                   window ('1h'|'24h'|'7d'), source, source_url, captured_at)   -- partitioned by month

-- Tenant-scoped
radar_runs        (id, workspace_id, run_date, scoring_model_id, status, started_at, finished_at)
opportunities     (id, workspace_id, radar_run_id, event_id, title, hook, angle, original_angle,
                   sport, why_now, competition_note, recommended_format,
                   rights_light, rights_note, source_urls jsonb,
                   gate_result ('pass'|'hold'|'ignore'), gate_reasons text[],
                   created_at)
opportunity_scores(id, workspace_id, opportunity_id, scoring_model_id,
                   trend, timeliness, curiosity, audience, competition_gap, originality,
                   production, rights, monetization,          -- 0..10 each
                   reasons jsonb,                              -- one sentence per sub-score (required)
                   score smallint check (score between 0 and 100), tier opp_tier,
                   created_at)                                 -- append-only: the prediction ledger
scoring_models    (id, version, weights jsonb, tier_thresholds jsonb, gates jsonb, active bool,
                   approved_by, created_at)
selections        (id, workspace_id, opportunity_id, decided_by, decision ('produce'|'skip'|'prebuild'),
                   reason, created_at)
-- Production reuses: projects (template = 'sports_short_v1', input = opportunity_id),
-- artifacts, claims, sources, assets, publications, metric_snapshots (Content Factory §6)
outcomes          (id, workspace_id, opportunity_id, publication_id, horizon ('24h'|'7d'|'28d'),
                   views, likes, comments, shares, saves, watch_time_s, avg_pct_viewed,
                   swipe_away_pct, ctr, subs_gained, captured_at)
```
Indexes: `events(starts_at)`, `signals(entity_id, captured_at desc)`, `opportunities(workspace_id, created_at desc)`, `opportunity_scores(opportunity_id, created_at desc)`, `outcomes(opportunity_id, horizon)`.

## 7. Supabase RLS policies (P2, draft; helper `private.has_role` from Content Factory §7)
```sql
-- Public sports data: readable by any authenticated user, writable only by the service role (ingestion workers)
alter table public.events  enable row level security;
create policy events_read on public.events for select to authenticated using (true);
-- same for sports, competitions, entities, signals; no insert/update/delete policies → only service_role writes

-- Tenant tables: members read, editors write
create policy opp_read on public.opportunities for select to authenticated
  using (private.has_role(workspace_id, array['owner','editor','reviewer','viewer']::member_role[]));
create policy opp_write on public.opportunities for insert to authenticated
  with check (private.has_role(workspace_id, array['owner','editor']::member_role[]));

-- Prediction ledger is append-only for everyone (no update/delete policies)
create policy score_insert on public.opportunity_scores for insert to authenticated
  with check (private.has_role(workspace_id, array['owner','editor']::member_role[]));

-- Selections are human decisions: insert only, decided_by must be the caller
create policy sel_insert on public.selections for insert to authenticated
  with check (decided_by = (select auth.uid())
              and private.has_role(workspace_id, array['owner','editor','reviewer']::member_role[]));

-- Only owners activate a scoring model (recalibration = founder decision)
create policy model_activate on public.scoring_models for update to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.user_id = (select auth.uid()) and m.role = 'owner'));
```
Plus a trigger: inserting into `projects` with an opportunity whose `rights_light = 'red'` or `gate_result <> 'pass'` raises an exception (ADR-S2 enforced in the DB, not only in code).

## 8. API
**Pilot (no code):** the Radar is a Markdown file; selection = founder reply / commit.

**P1 CLI** (same functions as later HTTP): `factory radar run [--date]` · `factory radar show [--tier s,a]` · `factory radar select <opp> produce|prebuild|skip -m` · `factory new --template sports_short_v1 --opportunity <opp>` · `factory calibrate --since 30d` (report only).

**P2 HTTP** (adds to Content Factory §8):
| Method | Path | Role | Effect |
|---|---|---|---|
| POST | `/api/radar/runs` | editor | starts a radar run (cron calls it with the service key) |
| GET | `/api/radar/runs/:id/opportunities?tier=` | viewer | TOP 10 with sub-scores and reasons |
| POST | `/api/opportunities/:id/select` | reviewer | `produce` / `prebuild` / `skip` → creates a `sports_short_v1` project if allowed by gates |
| GET | `/api/calibration?since=` | owner | predicted vs actual, per sub-score correlation, proposed weights |
| POST | `/api/scoring-models` | owner | new model version (inactive until approved) |

## 9. UI
- **Pilot:** the radar Markdown file (mobile-readable on GitHub) + the founder's reply.
- **P2:** *Radar board* (TOP 10 cards: score ring, tier badge, rights light, why-now, "Produce / Pre-build / Skip"); *Calendar* (upcoming stakes with pre-built stories and their trigger conditions); *Calibration* (scatter predicted vs actual, per sub-score).
- **QC checklist (prompt's quality bar), each PASS/FAIL, critical ones block publishing:** FACTS* · COPYRIGHT* · HOOK · RETENTION · EDITING · AUDIO · CAPTIONS · THUMBNAIL · TITLE · BRAND · ORIGINALITY* (* = critical).

## 10. Automations
- **Daily 07:45 Europe/Rome** radar run (pilot: Claude Routine, founder approval needed; P2: cron → `/api/radar/runs`).
- **Event triggers** for pre-built stories (e.g. "championship mathematically decided"): poll the official standings source at a set cadence on event days only.
- **Outcome sync** at +24 h, +7 d, +28 d after publishing (YouTube Analytics API).
- **Weekly calibration report** → if ρ drops or a sub-score has no predictive value, a PR proposes new weights; never auto-applied.
- Kill switch `EMERGENCY_STOP` (existing `08_AUTOMATION/configs/autonomy.yml`) checked before every run.

## 11. Roadmap (gated)
| Phase | Content | Exit criterion | Cost (ESTIMATE) |
|---|---|---|---|
| **S0 · Spec** (now) | this doc, `SCORING.md`, pilot radar, FD-012…016 | decisions closed | €0 |
| **S1 · Manual pilot** (14 days) | daily radar by Claude, ≤ 1 Short/day, founder voice, Cutroom, manual metrics | kill/continue criteria §3 | €0 (vidIQ credits only if the founder allows) |
| **S2 · Radar code** | `radar.*` modules + `sports_short_v1` template on the Content Factory engine (P1, SQLite) | radar run < 5 min, scores reproducible, ≥ 20 Shorts in the ledger | API only (re-check pricing) |
| **S3 · Calibration** | outcome sync + calibration report | ρ ≥ 0.3 or rubric revised | €0 |
| **S4 · Scale** | Supabase, multi-channel, 2nd language | repeatable growth + first revenue (sponsor or YPP) | UNKNOWN, re-check |

Sequencing vs PROJECT M: the pilot needs no engine code, so it does not block PROJECT M Gate 1. S2 shares the engine work already planned for Content Factory P1 (FD-007).

## 12. Risks
| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| **Focus dilution** (6th initiative, 0 revenue) | high | high | manual pilot only, day-14 kill criteria, no code before S1 result |
| Copyright claims / strikes on sports footage | high if footage used | high | ADR-S2/S3: footage RED by default, footage-free brand |
| Inauthentic-content demonetization | medium | high | 1 Short/day max, human voice, brand format, similarity check |
| Publishing a false fact (fast news, conflicting sources) | high (observed in pilot) | high | ADR-S6 source tiers + quote-verified fact check, Gate B required |
| Rubric is noise (scores don't predict performance) | medium | medium | prediction ledger + ρ check at 20 Shorts; drop sub-scores with no signal |
| Speed race vs big accounts | high | medium | compete on prepared analysis of scheduled stakes, not on clips |
| Defamation / athlete-conduct stories (e.g. disqualifications) | medium | high | stick to verified facts and quotes; no speculation on intent |
| Data API terms / costs | medium | medium | spike in S2; official sources first |
| Betting adjacency (odds as data) | medium | medium | odds only as context, never tips; check local gambling-ad rules before monetizing |

## 13. Tests
| Level | What |
|---|---|
| Unit | score = weighted sum (prompt weights sum to 100%); every sub-score in 0..10; reasons required; tier thresholds; **gates: RED → IGNORE whatever the score; unverified core claim → HOLD** |
| Golden | the 10 pilot opportunities in `radar/2026-10-07.md` re-scored by code give the same scores and tiers |
| Fact-check eval | planted false claims including the observed "Spain 2-1 Croatia quarter-final" case → must FAIL |
| DB/RLS (P2) | tenant isolation; `opportunity_scores` append-only; project creation from a RED opportunity raises; only owners activate a scoring model |
| Calibration | synthetic ledger with known correlation → report recovers it |
| E2E | radar run (fixtures) → select → `sports_short_v1` with mock providers → gates → export |

## 14. Folder structure (inside the Content Factory repo, FD-009)
```
factory/
├─ modules/radar/          # collect_events · collect_signals · angle (LLM) · score · calibrate
│  ├─ sources/             # one adapter per source (official sites, YouTube, pageviews, trends)
│  └─ evals/               # golden pilot radar, planted false claims
├─ pipelines/sports_short_v1.py
└─ brand/sports/           # visual system, script structure, thumbnail templates
studio-os/09_PLATFORM/sports-media-factory/
├─ ARCHITECTURE.md · SCORING.md
└─ radar/YYYY-MM-DD.md     # daily radar (pilot and later the job's human-readable export)
```

## 15. Future improvements (not before S4)
Long-form weekly recap (higher RPM) · newsletter · second language via dubbing · sponsor inventory per sport · athlete/creator partnerships for GREEN footage · learned scoring model once ≥ 200 outcomes exist.

---
## Open questions (minimal, blocking) → `00_CORE/founder-decisions.md`
1. **FD-012** Run the 14-day manual pilot (vs. park the idea until PROJECT M Gate 3)?
2. **FD-013** Market and language: Italian first (recommended) or English?
3. **FD-014** Voice: founder's own voice (recommended) or TTS?
4. **FD-015** Hard gates on top of the prompt's formula (recommended) — approve `SCORING.md` v0.1.
5. **FD-016** Daily radar as a scheduled Claude Routine (automation, €0) — yes/no.
