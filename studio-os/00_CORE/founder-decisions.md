# Founder decisions queue

## FD-001 — Name "Lilla" — **CLOSED (superseded 2026-09-29)**
The founder chose to start a new IP from scratch (D-004). Lilla research archived in `99_ARCHIVE/lilla/`.

## FD-002 — Move the OS to a private repo — **OPEN · P0**
Why: `taste-skill` is **public** (D-003). The new concept bible, name research and stories are held offline until this is done.
Founder steps (~3 min, €0):
1. github.com/new → name **`studio-os`** (brand-neutral, D-005) → **Private** → no README.
2. Give the Claude GitHub App access: https://github.com/apps/claude/installations/select_target
3. Open a new Claude session on `studio-os` and say "migra l'OS". Claude runs `git subtree split --prefix=studio-os` (history kept), pushes, commits the offline concept bible, creates labels and issues, and activates Actions.
4. Optional, afterwards: delete the branch `claude/lilla-studio-os-bootstrap-now61j` from taste-skill (irreversible, founder's call).

## FD-003 — Approve the budget allocation — **OPEN** (see `budget.md`)

## FD-004 — Name screening for PROJECT M — **OPEN**
Preliminary desk result (details offline): no children's-media conflict found, but a US trademark exists in an unrelated class and an app with the same name exists in class 9 (software). Founder runs TMview (EM, IT, WO · classes 9/16/25/28/41, phonetic search) → keep / adjust / choose one of the backup names.

## FD-005 — Tool stack and first paid tools — **OPEN**
See `00_CORE/tools-stack.md`. Recommended: €0 until CAL-01, then **one** month of **one** video generator (≈ €10–20), no annual plans, cancel the renewal on day 1.

## FD-006 — Approve the Content Factory architecture v0.2 — **OPEN**
Evidence: `09_PLATFORM/content-factory/ARCHITECTURE.md`. Key choices: one Python engine (ClipForge core) with templates, a deterministic DAG orchestrator (not an LLM), versioned artifacts, human-only approval, rights ledger, quote-grounded fact-check, SQLite → Supabase.
Also needed: **the rest of the master prompt** (cut off at Agent 11).

## FD-007 — The engine's first template — **OPEN**
1. **`preschool_episode_v1` (PROJECT M)**: already planned as "week 3 pipeline code" → no extra work — *recommended*
2. `short_explainer_v1` (a new factual channel, uses research and fact-check) → a second channel to run
3. `clip_v1` as a paid service (clipping for creators or businesses that **own** their content) → the fastest revenue test (HYPOTHESIS), but it needs founder time for selling

## FD-008 — API budget for building the factory — **OPEN**
P1 ESTIMATE: < €2 per test video, 3 videos → < €10. Separate from the €300, or inside it? Infra stays €0 in P1 (local + SQLite).

## FD-009 — Dedicated repo `content-factory` — **OPEN**
The integration can't create repos (403). The founder creates it (private or public: the code contains no IP) → ClipForge moves in as the first template.

## FD-010 — ClipForge compliance fixes — **OPEN**
(a) A required rights gate at ingest: download only `user_owned`/`licensed` content; `watch` only on owned or authorized channels (YouTube ToS). (b) Rename "viral score" to `rank_score` (LLM estimate). Small, €0; needs approval because it changes the behavior of existing code.
