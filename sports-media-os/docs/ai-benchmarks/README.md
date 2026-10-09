# AI benchmark reports

Output of `npm run ai:benchmark` — the measure → compare → document step of
[`docs/AI_COST_CONTROL.md`](../AI_COST_CONTROL.md) (section 8).

| File | Produced by | Contains |
|---|---|---|
| `<YYYY-MM-DD>-<task>-estimate.md` | `--write` (dry run) | Cost estimate per model from the fixture prompts. No API calls. |
| `<YYYY-MM-DD>-<task>.md` | `--run` | Measured latency, tokens, cost, schema-valid and grounded-id rates per model, failed calls, a cheapest-first suggestion and a **Decision** section to fill in. |

A second report on the same day gets a `-2`, `-3`… suffix; reports are never
overwritten. Commit a run report together with the routing change it justifies.

Inputs are the invented, clearly fictional fixtures in `tests/fixtures/ai/`.

**Status (2026-10-09):** only dry-run estimates exist. No API keys are configured
in this environment, so there are no measured runs yet.
