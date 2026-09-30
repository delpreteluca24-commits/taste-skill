# Founder decisions queue

## FD-001 — Name "Lilla": confirm, adjust, or clear it legally first — **OPEN**
Evidence: `07_RESEARCH/ip/name-validation.md`
Options:
1. Keep **Lilla** as a working name and do a manual TMview/EUIPO check (free, ~30 min) before Gate 1 Step 2 — *recommended*
2. Keep Lilla + pay for a professional clearance search — cost UNKNOWN, needs a quote
3. Pick a distinctive compound form (e.g. "Lilla + distinctive word") to strengthen the trademark
4. Rename — not recommended until the manual check is done
Rejected by the research: **Lylla** (Marvel/Disney character), **Lila** (Mattel Polly Pocket character, the everyday word for purple).

## FD-002 — Migrate the OS to its own private repo `lilla-studio-os` — **OPEN**
Create an empty private repo and give Claude access → migrate with history kept.

## FD-003 — Approve the proposed budget allocation — **OPEN** (see `budget.md`)

## FD-004 — Approve the Content Factory architecture v0.1 — **OPEN**
Evidence: `09_PLATFORM/content-factory/ARCHITECTURE.md`. Key choices: deterministic DAG orchestrator (not an LLM), versioned artifacts, human-only approval enforced in the DB, rights ledger, quote-grounded fact-check, Supabase + Remotion + FFmpeg.
Options: approve · approve with changes · reject. Also needed: **the rest of the master prompt** (it's cut off at Agent 11).

## FD-005 — Which channel does the factory serve first? — **OPEN**
1. **Lilla first, shared core** (script → voice → visuals → captions → render → QA). Research and fact-check come later — *recommended* (one focus, a real user right away, Gates 2–3 need it anyway)
2. A new factual/educational channel first (uses the whole spec, including research and fact-check) → Lilla pauses
3. Both in parallel — not recommended (founder time is the bottleneck)

## FD-006 — Budget for API usage while building the factory — **OPEN**
P1 ESTIMATE: < €2 per test video (LLM + TTS + images), 3 videos → < €10. Separate from Lilla's €300, or inside it? Infra stays €0 in P1 (free tiers + local runs).

## FD-007 — Dedicated repo `content-factory` — **OPEN**
The integration can't create repos (403). The founder creates an empty private repo and gives access → the code goes there, never into taste-skill.
