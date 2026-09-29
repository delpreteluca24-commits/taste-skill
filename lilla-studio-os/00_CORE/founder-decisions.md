# Founder decisions queue

## FD-001 — Name "Lilla": confirm, adjust, or clear it legally first — **OPEN**
Evidence: `07_RESEARCH/ip/name-validation.md`
Options:
1. Keep **Lilla** as a working name and do a manual TMview/EUIPO check (free, ~30 min) before Gate 1 Step 2 — *recommended*
2. Keep Lilla + pay for a professional clearance search — cost UNKNOWN, needs a quote
3. Pick a distinctive compound form (e.g. "Lilla + distinctive word") to strengthen the trademark
4. Rename — not recommended until the manual check is done
Rejected by the research: **Lylla** (Marvel/Disney character), **Lila** (Mattel Polly Pocket character, the everyday word for purple), **Lilà** (LìLà Toys, Florence, added 2026-09-29).
*New evidence 2026-09-29:* "Lilla" **+ unicorn** comes close to *Lily the Unicorn* (Jim Henson Co.) → this is also an input for choosing the character direction (G1-S2).

## FD-002 — Migrate the OS to its own private repo `lilla-studio-os` — **OPEN · P0 (escalated 2026-09-29)**
Why P0: `taste-skill` is a **public** fork, so the budget, strategy and name research on this branch are publicly readable. Character studies are on hold until the OS moves (D-003).
Founder steps (~3 min, €0):
1. github.com/new → name `lilla-studio-os` → **Private** → no README.
2. Give the Claude GitHub App access to it: https://github.com/apps/claude/installations/select_target (Claude can't create repos: 403).
3. In a new Claude session attached to `lilla-studio-os`, say "migrate the OS". Claude runs `git subtree split --prefix=lilla-studio-os` (history kept), pushes, creates labels and issues, and activates the workflows.
4. Optional, after migrating: delete the branch `claude/lilla-studio-os-bootstrap-now61j` from taste-skill. That is irreversible, so it's the founder's call.

## FD-003 — Approve the proposed budget allocation — **OPEN** (see `budget.md`)
