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

## D-003 — Content Factory: architecture proposal before any code
DATE: 2026-09-30 | OWNER: CEO/CTO agent | REASON: The founder shared the "AI YouTube Content Factory" master prompt (truncated at Agent 11).
FACTS: No video has been produced yet. YouTube renamed "repetitious content" to "inauthentic content" (mass-produced/repetitive content can't be monetized) on 2025-07-15 (YouTube Help, accessed 2026-09-30). Remotion is free for teams of ≤3 people, even for SaaS (remotion.dev license FAQ, accessed 2026-09-30).
ASSUMPTIONS: A shared production core can serve both Lilla and a future factual channel (HYPOTHESIS).
OPTIONS: (a) build the full 11-agent SaaS now; (b) architecture first, then a walking skeleton that carries one format end to end; (c) postpone until Lilla reaches Gate 3.
DECISION (proposed): (b). See `09_PLATFORM/content-factory/ARCHITECTURE.md`. No code until FD-004 is approved.
EXPECTED RESULT: A factory extracted from real production, with a data model that's ready for multi-tenant use.
RISK: Two parallel projects for one founder → mitigated by FD-005 (shared core, one channel at a time).
REVERSIBILITY: reversible
FOLLOW-UP DATE: 2026-10-07
ACTUAL RESULT: —
LEARNING: —
