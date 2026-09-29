# Current state — 2026-09-29
- **Gate:** 0 COMPLETED → Gate 1 PREPARATION (restarted for the new concept, D-004)
- **Concept:** PROJECT M approved by the founder (replaces Lilla → `99_ARCHIVE/lilla/`). Agent architecture approved (11 agents, human-in-the-loop publishing).
- **Autonomy:** LEVEL 2 (PREPARE)
- **Spent:** €0 / €300 (reserve €90 untouched)
- **Production:** none started. No purchases made.
- **Blocking decisions:** **FD-002 private repo (P0)** → blocks the concept bible, character studies and issues · FD-004 name screening · FD-003 budget · FD-005 tool stack.
- **Infra:** OS temporarily at `taste-skill/studio-os/` on a **PUBLIC** fork (D-002, D-003). GitHub Actions stay inactive until migration.

## Integrations (re-verified 2026-09-29)
| Integration | Status | Needed at | Note |
|---|---|---|---|
| GitHub | ✅ connected | now | Can't create repos (403) → founder creates `studio-os` (private) |
| Private repo | ❌ missing | **now** | FD-002 |
| Network allowlist | ⚠️ restricted | now | tmdn.org, euipo.europa.eu, branddb.wipo.int, rdap.org, youtube.com, wikipedia.org blocked → name checks are manual |
| Google Drive | ❌ not connected | Gate 2 | asset storage (free 15 GB) |
| Higgsfield (or another generator) | ❌ not connected | Gate 2 (CAL-01) | FD-005 |
| YouTube channel + API (OAuth) | ❌ not created | Gate 3 | Brand Account; Google Cloud project (free) |
| ffmpeg, jsonschema, pytest | ❌ not installed in the environment | Gate 2 | environment setup script (free) |
