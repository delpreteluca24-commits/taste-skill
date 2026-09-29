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
