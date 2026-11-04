# AI cost estimate (dry run, no API calls): scoring (2026-10-09)

- Task: `scoring` · prompt `opportunity-scoring-v1` · effort `low` · output cap 4,000 tokens
- Inputs: 6 fixture case(s) × 1 from `tests/fixtures/ai/scoring.json` (invented, clearly fictional data — not real events)
- Prices: `lib/ai/pricing.ts` (as of 2026-10-06); unknown models are "unpriced", never guessed

Input tokens are estimated from the real prompts (≈ 4 characters per token). Output is an assumption
(450 tokens per call, thinking included) — measure with `--run` before deciding.

| Model | Calls | Input tokens | Typical cost | With prompt cache | Upper bound (full output cap) | Per 100 calls | × cheapest |
|---|---:|---:|---:|---:|---:|---:|---:|
| `anthropic:claude-haiku-5-5` | 6 | 4,059 | $0.0018 | $0.0018 | $0.01 | $0.03 | ×1 |
| `anthropic:claude-sonnet-5-5` | 6 | 4,059 | $0.04 | $0.04 | $0.25 | $0.59 | ×20 |
| `anthropic:claude-opus-5-5` | 6 | 4,059 | $0.07 | $0.07 | $0.50 | $1.17 | ×40 |
