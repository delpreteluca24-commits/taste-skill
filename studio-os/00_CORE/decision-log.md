# Decision Log

Template:
```
## D-XXX — <title>
DATE: | OWNER: | REASON:
FACTS:
ASSUMPTIONS:
OPTIONS:
DECISION:
EXPECTED RESULT:
RISK:
REVERSIBILITY: reversible / partially / irreversible
FOLLOW-UP DATE:
ACTUAL RESULT:
LEARNING:
```

---

## D-001 — Adopt Lilla Studio OS architecture
DATE: 2026-09-22 | OWNER: Founder (bootstrap brief) / CEO agent | REASON: Structure is needed before any spending.
FACTS: Budget €300; Gate 0 completed per founder.
ASSUMPTIONS: A GitHub-centric OS lowers coordination cost for the AI agents.
OPTIONS: (a) full OS; (b) lightweight docs only; (c) start producing right away.
DECISION: (a), but with only the minimum infrastructure (no paid tools).
EXPECTED RESULT: Every step that follows can be traced and measured.
RISK: Over-engineering before validation. Mitigation: no code beyond safe workflows.
REVERSIBILITY: reversible
FOLLOW-UP DATE: 2026-10-06
ACTUAL RESULT: —
LEARNING: —

## D-002 — Temporary location of the OS
DATE: 2026-09-22 | OWNER: CEO agent | REASON: The integration can't create new repositories (HTTP 403).
FACTS: Creating the `lilla-studio-os` repo failed with a 403. The only accessible repo is `taste-skill` (an unrelated fork).
DECISION: Bootstrap inside `taste-skill/lilla-studio-os/` on branch `claude/lilla-studio-os-bootstrap-now61j`. GitHub Actions stay **inactive** (a `.github` folder only runs at the repo root). That is safe by default.
FOLLOW-UP: The founder creates an empty private repo `lilla-studio-os` and gives access → migrate with `git subtree split` (history kept).
REVERSIBILITY: reversible

## D-003 — Hold IP-sensitive work while the OS lives in a public repo
DATE: 2026-09-29 | OWNER: CEO agent | REASON: The host repo turned out to be public.
FACTS: `delpreteluca24-commits/taste-skill` is `private: false, fork: true` (GitHub API, 2026-09-29). `create_repository` still returns 403.
ASSUMPTIONS: HYPOTHESIS: publishing unreleased character designs and canon before the name is cleared and handles are reserved raises the risk of squatting and copying. The research already pushed is low-sensitivity (it summarizes public sources).
OPTIONS: (a) keep working publicly; (b) hold IP-sensitive work until a private repo exists; (c) delete the public branch now.
DECISION: (b). Low-sensitivity docs and research may still be committed. Character studies, canon, prompts and stories wait. Issues are not opened on the public repo. (c) is irreversible, so it is left to the founder (FD-002 step 4).
EXPECTED RESULT: Zero new IP exposure; migration unblocks everything.
RISK: G1-S2 is delayed if FD-002 waits. Mitigation: the founder action takes about 3 minutes.
REVERSIBILITY: reversible
FOLLOW-UP DATE: when FD-002 closes
ACTUAL RESULT: —
LEARNING: Check repo visibility at bootstrap, before writing anything. Added to the CEO memory.

## D-004 — New IP from scratch replaces Lilla; agent architecture approved
DATE: 2026-09-29 | OWNER: **Founder** | REASON: The founder asked for an original concept built on a market gap; the "Lilla" name was crowded (see archive).
FACTS: Market scan 2026-09-29 (offline bible §1): Made-for-Kids RPM ≈ $0.5–3 (ESTIMATE); YouTube "inauthentic content" policy clarified 2026-07-16; API uploads from unverified projects are forced private.
DECISION: Concept PROJECT M approved to test. Lilla → `99_ARCHIVE/lilla/`. Architecture approved: 11 agents (new 09 QC & Child Safety, 10 Assembler), Claude Code subagents, private uploads + one-click founder publishing.
EXPECTED RESULT: A concept that fits the market gap and cheap AI production (calm pacing, no lip sync).
RISK: Name not screened (FD-004); €5k/month from ads alone is unlikely → diversified revenue plan.
REVERSIBILITY: reversible (nothing produced or spent)
FOLLOW-UP DATE: after G1-S2
ACTUAL RESULT: —
LEARNING: —

## D-005 — Brand-neutral repo and folder names
DATE: 2026-09-29 | OWNER: CEO agent | REASON: The IP name isn't cleared yet; renaming repos later is costly.
DECISION: `lilla-studio-os/` → `studio-os/`, `02_LILLA_IP/` → `02_IP/`; the future private repo is called `studio-os`. The public codename is PROJECT M.
REVERSIBILITY: reversible

## D-006 — Content Factory: one engine, architecture before code
DATE: 2026-09-30 | OWNER: CEO/CTO agent | REASON: The founder shared the "AI YouTube Content Factory" master prompt (cut off at Agent 11).
FACTS: No video published yet. ClipForge (Python, local clipper) already exists at `/clipforge`. YouTube renamed "repetitious content" to "inauthentic content" on 2025-07-15 (YouTube Help, accessed 2026-09-30). YouTube ToS forbid downloading content except as the Service authorizes or with permission (accessed 2026-09-30). Remotion is free for teams of ≤3 people (license FAQ, accessed 2026-09-30).
ASSUMPTIONS: One engine with templates can serve PROJECT M, clipping and factual explainers (HYPOTHESIS).
OPTIONS: (a) a new TypeScript SaaS with 11 agents now; (b) generalize the ClipForge core into a Python engine with pipeline templates, gated; (c) postpone until PROJECT M reaches Gate 3.
DECISION (proposed): (b). See `09_PLATFORM/content-factory/ARCHITECTURE.md` v0.2 (v0.1 proposed a TypeScript/Remotion stack; dropped so we don't start a 4th codebase). No new code until FD-006 is approved.
EXPECTED RESULT: One engine, extracted from PROJECT M's real production; data model ready for multi-tenant use.
RISK: Scattered focus → one template at a time (FD-007).
REVERSIBILITY: reversible
FOLLOW-UP DATE: 2026-10-07
ACTUAL RESULT: —
LEARNING: Fetch the remote branch before writing: parallel sessions moved the OS (lilla-studio-os → studio-os) while this proposal was being drafted.

## D-007 — Cutroom: AI social video editor, Phase 1 built
DATE: 2026-10-01 | OWNER: **Founder** (explicit "build it now" in the master prompt) · CTO agent | REASON: The founder asked for a working AI editor that turns 2+ clips into one 9:16 short with chat editing.
FACTS: Built in `/cutroom` (TypeScript: React + Remotion + Fastify + ffmpeg + transformers.js Whisper). TEST RESULT 2026-10-01 on 5 real phone clips (148 s raw): auto edit → 60 s (Viral), chat "massimo 30 secondi" → 29.2 s, export 1080×1920 H.264 in 143 s on 4 CPU, −14.0 LUFS. 50 automated tests. HuggingFace was blocked in the build sandbox, so only `whisper-base` was tested there: Italian transcripts on noisy kitchen audio are poor.
ASSUMPTIONS: HYPOTHESIS: local creators/SMBs would pay for "raw clips → publishable short" (links to the local-AI-agency skill). Not validated.
OPTIONS: (a) keep Cutroom as an internal tool for PROJECT M / clients; (b) sell edited shorts as a service (fastest revenue test); (c) SaaS.
DECISION: Phase 1 shipped as an internal tool. No SaaS work (auth, billing, Supabase) before FD-011.
RISK: Fifth initiative in three days (Lilla → PROJECT M → ClipForge → Content Factory → Cutroom). Overlaps ClipForge (long→short clipper, Python): Cutroom is the opposite direction (many short clips → one edit) and the reusable editor UI.
REVERSIBILITY: reversible (local tool, €0 spent)
FOLLOW-UP DATE: 2026-10-08
ACTUAL RESULT: —
LEARNING: Validate the toolchain in a spike first (model download hosts, codecs in headless Chromium) before building.
