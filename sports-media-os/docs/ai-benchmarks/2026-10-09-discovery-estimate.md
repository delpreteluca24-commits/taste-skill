# AI cost estimate (dry run, no API calls): discovery (2026-10-09)

- Task: `discovery` · prompt `trend-label-v1` · effort `low` · output cap 4,000 tokens
- Inputs: 3 fixture case(s) × 1 from `tests/fixtures/ai/discovery.json` (invented, clearly fictional data — not real events)
- Prices: `lib/ai/pricing.ts` (as of 2026-10-06); unknown models are "unpriced", never guessed

Input tokens are estimated from the real prompts (≈ 4 characters per token). Output is an assumption
(700 tokens per call, thinking included) — measure with `--run` before deciding.

| Model | Calls | Input tokens | Typical cost | With prompt cache | Upper bound (full output cap) | Per 100 calls | × cheapest |
|---|---:|---:|---:|---:|---:|---:|---:|
| `anthropic:claude-haiku-5-5` | 3 | 2,655 | $0.0013 | $0.0013 | $0.0063 | $0.04 | ×1 |
| `anthropic:claude-sonnet-5-5` | 3 | 2,655 | $0.03 | $0.03 | $0.13 | $0.88 | ×20 |
| `anthropic:claude-opus-5-5` | 3 | 2,655 | $0.05 | $0.05 | $0.25 | $1.75 | ×40 |
