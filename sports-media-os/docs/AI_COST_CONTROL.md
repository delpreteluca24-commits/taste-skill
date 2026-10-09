# AI cost control

How Sports Media OS keeps AI spend low and visible. Applies to every model call
the system makes. Code: `lib/ai/*` (routing, router, pricing), `workers/` (the
only place models run), `lib/opportunities/ai-cost.ts` (batch guard),
Settings → AI (`app/(app)/settings`, `components/settings/*`).

**The rules in one paragraph.** Models never run in a web request: pages enqueue
a job and the worker calls the AI router. Each task has its own model, and the
default is the cheapest model that fits the task. Expensive models are opt-in
per task, never automatic. Batch jobs estimate their cost before they are queued
and stop at a budget. Every call is written to the `ai_usage` ledger with tokens
and cost; unknown prices stay unknown (`null`), never guessed. Before a batch
task moves to a pricier model, the change is measured, compared and documented
with `npm run ai:benchmark`, and the cheaper model is kept when quality holds.

---

## 1. Per-task routing and defaults

Five tasks (`lib/ai/types.ts` → `AI_TASKS`), each routed independently
(`lib/ai/models.ts` → `TASK_DEFAULTS`):

| Task | Volume | Default model | Effort | Output cap | Price in / out (per 1M tokens) | Indicative cost / 100 calls* | Why this default |
|---|---|---|---|---:|---|---:|---|
| `discovery` — name trend clusters | batch | `anthropic:claude-haiku-5-5` | low | 4,000 | $0.10 / $0.50 | $0.04 | Short, constrained labelling of headlines. Clustering is deterministic (`lib/trends/cluster.ts`); every name/number in a label is checked against the headlines (`lib/trends/labels.ts`), so a cheap model is enough and a bad label just keeps the heuristic title. |
| `scoring` — refine 4 score components | batch (≤ 50 per job) | `anthropic:claude-haiku-5-5` | low | 4,000 | $0.10 / $0.50 | $0.03 | Judgement scores with short reasons; values are suggestions, manual values always win, cited ids are validated (`lib/opportunities/ai-scoring.ts`). Runs on whole selections, so price per call dominates. |
| `research` — plan, claims, timeline | per item | `anthropic:claude-sonnet-5-5` | medium | 8,000 | $2 / $10 | $1.58 | One call per opportunity; must extract claims with the right source ids and turn gaps into questions. Mistakes cost producer time. |
| `script` — angles, hooks, rewrites | per item | `anthropic:claude-sonnet-5-5` | medium | 12,000 | $2 / $10 | $1.38 | Writing quality matters and the grounding rules are strict (facts by id, hedged uncertain claims, exact quotes). |
| `fact_check` — assess one claim | per item | `anthropic:claude-sonnet-5-5` | high | 6,000 | $2 / $10 | $0.68 | Careful reading of excerpts for one claim at a time; the answer is a suggestion a person applies. |

\* Indicative: typical call per task (`components/settings/ai-routing.ts` →
`TYPICAL_CALL`): input = average real prompt on the benchmark fixtures; output is
an **assumption** that includes adaptive-thinking tokens (on current Claude
models output tokens include thinking, so effort changes cost). No prompt
caching. The ledger has the real numbers.

**Premium models are opt-in.** Claude Opus 5.5 ($4 / $20) and Claude Fable 5.1
($10 / $50) are never a default. Per token they cost 2× / 5× Sonnet 5.5 and
40× / 100× Haiku 5.5. Use one only for a per-item task, per task, after a
benchmark shows the cheaper model misses the quality bar. Settings flags a batch
task whose model costs ≥ 1.5× its default (or is unpriced) with a "measure
first" warning.

Prices: `lib/ai/pricing.ts` (Anthropic list prices, as of 2026-10-06 — re-check
before relying on them for a budget). Haiku 5.5 bills a long-context tier above
100K prompt tokens ($0.50 / $2.50). Models not in the table (e.g. OpenAI) are
**unpriced** until you add them to `AI_PRICING_JSON`
(`{"model-id":{"input":1,"output":4}}`, USD per 1M tokens).

## 2. Precedence: Settings > env > default

For each task the primary model is the first that is set:

1. **Settings → AI → per-task override** (workspace-wide, admins only; stored in
   the `settings` table, key `ai`, field `tasks.<task>`).
2. **Environment**: `DISCOVERY_MODEL`, `SCORING_MODEL`, `RESEARCH_MODEL`,
   `SCRIPT_MODEL`, `FACT_CHECK_MODEL` (server env of the worker and the app).
3. **Code default** (table above).

Format: `provider:model` (`anthropic:claude-haiku-5-5`, `openai:<model>`); a bare
`claude-…` id means Anthropic. Invalid ids are rejected when saving. An empty
field means *inherit* — the input's placeholder shows what it would inherit.
Effort comes from the Settings override or the task default; the output cap is
the task default. Settings shows the **effective** model per task with a source
badge (Settings / Env · `SCORING_MODEL` / Default), its price and an indicative
cost per 100 calls. That view is computed on the server; API keys never reach
the browser (only "configured / missing").

## 3. Fallback chain

`primary → task fallback (Settings) → AI_FALLBACK_MODEL (env)`, duplicates
removed (`lib/ai/router.ts`):

- A provider without an API key is **skipped** — no call, no cost.
- Any failure moves to the next model: rate limit, overload, timeout, network,
  auth, refusal, output that fails the zod schema, truncated output.
- Every real attempt is logged to `ai_usage` with its attempt number, so a
  failing primary shows up as errors on the primary plus calls on the fallback.
- If every model fails the job fails with a readable error (`all_failed`, with
  each attempt); if no model in the chain has a key: `not_configured`. Never a
  fake or default answer.

## 4. Refusal fallback

- **Server-side** (Claude Sonnet 5.5, Opus 5.5, Opus 5, Fable 5.1): the Anthropic
  provider sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`),
  so a policy refusal is re-run by the API on a fallback model inside the same
  call. The ledger records the model that actually served the request.
- **Haiku 5.5 has no server-side refusal fallback**: a refusal becomes
  `AIError("refused")`, is logged with status `refused`, and the router moves to
  the next model in the chain (set a task fallback if this matters).

## 5. Batch cost guard

For any job that makes many calls (today: AI scoring of a selection of
opportunities — `lib/opportunities/ai-cost.ts`, `workers/handlers/opportunity-ai-score.ts`):

1. **Estimate before enqueueing**: the real prompt of every call (≈ 4 characters
   per token) + the task's **full output cap**, priced for the task's primary
   model — an upper bound.
2. **Decide**: at or below **Settings → AI → Batch cost limit** (default $1,
   range 0–1000, 0 = always ask) the job is queued. Above it, the user sees the
   estimate and the job runs only after they confirm at least that amount. An
   unpriced model always needs a confirmation.
3. **Enforce in the worker**: the budget is the limit, or the confirmed amount
   if higher. The worker stops calling models once the spend reaches it; the
   remaining items are reported as skipped.

New batch features must reuse `estimateRequestsCost` / `decideBatchCost` /
`batchBudgetUsd` and send stable system prompts with `cacheSystemPrompt: true`.

## 6. The `ai_usage` ledger

One row per real model call (success, error or refusal): project, task,
provider, model, job, agent run, attempt, status, error code, input / output /
cache-read / cache-write tokens, `cost_usd`, latency. Written only by the worker
(service role); users cannot insert or change rows. RLS: project members read
their project's rows; rows without a project only app admins.
`public.ai_usage_summary(p_project_id, p_days)` aggregates per task and model
for Settings (SECURITY INVOKER, so RLS applies to it too). `cost_usd` is `null`
when the model has no price. Benchmark runs (section 8) are not in the ledger.

## 7. Reading the usage panel

**Settings → AI usage · <project>** — last 30 days of the active project:

- **Cost**: sum of priced calls only. "+ N unpriced calls" means some cost is
  unknown and **not** in the total; add the price to `AI_PRICING_JSON`.
- **Calls**: every attempt, including fallbacks and failures.
- **Errors**: failed or refused attempts. A high count on one model usually means
  a missing/invalid key, rate limits, or output that keeps failing the schema.
- **Tokens in / out**: in = uncached prompt tokens (cache tokens are priced in
  the cost but not shown); out includes thinking.
- **Table per task × model**: cost per call = cost ÷ calls. Things to look for —
  a fallback model with many calls (the primary is failing), a premium model on
  a batch task (someone changed the routing: check for a benchmark report), a
  task whose cost grows faster than its call count (prompts got longer or the
  effort went up).

Empty panel = no AI calls yet for this project.

## 8. Measure → compare → document → cheaper first

Before a batch task uses a pricier model (and whenever a prompt changes
materially):

1. **Estimate (no calls, no keys)**
   `npm run ai:benchmark -- --task scoring --models anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5`
   Prints typical / cached / upper-bound cost per model and the ratio to the
   cheapest. `--write` saves it to `docs/ai-benchmarks/<date>-<task>-estimate.md`.
2. **Measure** — add `--run` (needs the provider keys). Each model runs alone
   (single-model chain, no fallback) on `tests/fixtures/ai/<task>.json` through
   the **production prompt and output schema** of that task, with the system
   prompt cached as in the worker. It refuses to start if the upper-bound
   estimate exceeds `--max-usd` (default $1). Options: `--limit N` cases,
   `--repeat N`, `--effort <level>`.
3. **Compare** — the report gives per model: schema-valid rate, grounded-id rate
   (every source/fact/quote id returned was one we provided), errors by kind,
   latency avg/p50/p95, average tokens, total cost and cost per 100 calls. Read a
   sample of outputs too; the report lists every failed or ungrounded call.
4. **Document** — the report is written to `docs/ai-benchmarks/<date>-<task>.md`.
   Fill in its *Decision* section and commit it with the routing change.
5. **Cheaper first** — keep the cheapest model with ≥ 95% schema-valid and
   grounded outputs that also passes the human read (the report suggests it).
   Only then change Settings or the env var. Also try a lower effort on the
   current model before switching to a pricier one.

Fixtures are invented and clearly fictional (fictional leagues and people,
`example.test` URLs, "(fixture)" publishers) — never copy real articles into
them. Add cases for failure modes you see in production, rewritten as fiction.

## 9. Current status (2026-10-09)

- **No live measurements yet in this environment: no API keys are configured.**
  The defaults are based on task shape and list prices, not on measured quality.
- Dry-run estimates on the fixtures (cost per 100 calls, typical output, no
  caching) — reports: [`2026-10-09-discovery-estimate.md`](ai-benchmarks/2026-10-09-discovery-estimate.md),
  [`2026-10-09-scoring-estimate.md`](ai-benchmarks/2026-10-09-scoring-estimate.md):

  | Task | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
  |---|---:|---:|---:|
  | discovery | $0.04 | $0.88 | $1.75 |
  | scoring | $0.03 | $0.59 | $1.17 |
  | research | $0.08 | $1.58 | $3.15 |
  | script | $0.07 | $1.38 | $2.76 |
  | fact_check | $0.03 | $0.67 | $1.35 |

- First steps once keys exist: `--run` for discovery and scoring (confirm Haiku
  holds), then research and fact_check with Haiku vs Sonnet (a cheaper model may
  be enough for some of them).
- Known limits: token estimates use ≈ 4 characters per token; output tokens in
  estimates are assumptions; the usage panel does not show cache tokens (the
  summary RPC does not return them); benchmark spend is only in the reports.

## 10. Checklist for a new AI feature

- Reuse one of the five tasks (or add one in `lib/ai` with a cheap default and a
  rationale here). Prompts live in `prompts/<area>/<name>.ts` with a version.
- Call models only from a worker handler: `ctx.withAgentRun` → `ctx.ai()` →
  `ai.generateObject(task, { system, messages, cacheSystemPrompt: true }, schema)`.
- Pass only the facts/sources the model may use, with ids; validate every id it
  returns; bound the prompt size (`MAX_*` constants).
- Batch? Use the batch cost guard (section 5).
- Add `tests/fixtures/ai/<task>.json` cases and run the benchmark before choosing
  a non-default model.
