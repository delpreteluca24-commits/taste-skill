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
