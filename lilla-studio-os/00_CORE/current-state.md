# Current state — 2026-09-29
- **Gate:** 0 COMPLETED → Gate 1 PREPARATION
- **Autonomy:** LEVEL 2 (PREPARE)
- **Spent:** €0 / €300 (reserve €90 untouched)
- **Production:** none started. No purchases made.
- **Active step:** G1-S1 name validation → report re-run 2026-09-29: `07_RESEARCH/ip/name-validation.md`
- **Blocking decisions:** FD-001 (name) → blocks G1-S2 · **FD-002 (private repo) is now P0** (see D-003)
- **Infra:** OS temporarily inside `taste-skill/lilla-studio-os/` (D-002). **`taste-skill` is a PUBLIC fork**, so everything on this branch can be read by anyone. GitHub Actions stay inactive until the OS is migrated.
- **Hold (D-003):** no character studies, canon or unreleased IP material gets committed until the OS is in a private repo.

## Integrations (re-verified 2026-09-29)
| Integration | Status | Note |
|---|---|---|
| GitHub MCP | ✅ connected | files and push work · `create_repository` → **403** again (the integration can't create repos) · no issues or PRs on taste-skill · issues are not created on a public repo (D-003) → drafts in `00_CORE/issue-drafts/` |
| Higgsfield MCP | ❌ not connected | not in this session's tool list. Nothing to spend = safe |
| YouTube API | ❌ not connected | no connector; needs a Google Cloud project + OAuth (founder). `youtube.com` blocked by egress |
| Google Drive | ❌ not connected | connectors present: Gmail, Calendar, Supabase, Vercel, Lovable, Hugging Face. None of them are needed now |
| TMview / EUIPO / WIPO / RDAP | ⚠️ blocked | the egress policy denies tmdn.org, euipo.europa.eu, branddb.wipo.int, rdap.*; only web search works → manual check by the founder |
