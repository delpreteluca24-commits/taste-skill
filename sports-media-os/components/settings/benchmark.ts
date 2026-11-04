import { z } from "zod";

import { formatModelRef, parseModelRef, TASK_DEFAULTS } from "@/lib/ai/models";
import { costFor, estimateTokens, PRICES_AS_OF } from "@/lib/ai/pricing";
import { createAIRouter } from "@/lib/ai/router";
import {
  AI_TASKS,
  AIError,
  EFFORTS,
  type AIMessage,
  type AIProvider,
  type AIProviderId,
  type AITask,
  type Effort,
  type ModelRef,
  type UsageEvent,
} from "@/lib/ai/types";
import { EDITORIAL_FORMATS, type EditorialFormat } from "@/lib/rights/alternatives";
import { SCRIPT_ANGLES, type ScriptAngle } from "@/lib/scripts/schema";
import { buildTrendLabelMessages, TREND_LABEL_PROMPT_VERSION, TREND_LABEL_SYSTEM, trendLabelOutputSchema, type TrendLabelInput } from "@/prompts/discovery/trend-label";
import {
  buildFactCheckMessages,
  FACTCHECK_ASSESS_PROMPT_VERSION,
  FACTCHECK_ASSESS_SYSTEM,
  factCheckOutputSchema,
  type FactCheckAssessInput,
} from "@/prompts/factcheck/assess";
import {
  buildResearchSuggestMessages,
  RESEARCH_SUGGEST_PROMPT_VERSION,
  RESEARCH_SUGGEST_SYSTEM,
  researchSuggestOutputSchema,
  type ResearchSuggestInput,
} from "@/prompts/research/suggest";
import {
  AI_SCORED_COMPONENTS,
  buildOpportunityScoringMessages,
  OPPORTUNITY_SCORING_PROMPT_VERSION,
  OPPORTUNITY_SCORING_SYSTEM,
  opportunityScoringOutputSchema,
  type OpportunityScoringInput,
} from "@/prompts/scoring/opportunity";
import { buildAngleMessages, SCRIPT_PROMPT_VERSION, SCRIPT_SYSTEM, scriptOutputSchema } from "@/prompts/script/angles";
import { limitContext, type StoryPromptContext } from "@/prompts/script/context";

import { TYPICAL_CALL } from "./ai-routing";

/**
 * AI benchmark helpers (pure; used by scripts/ai-benchmark.mts, unit-tested).
 *
 * MEASURE → COMPARE → DOCUMENT → CHEAPER FIRST: before a batch task moves to a
 * pricier model, the same fixture inputs run through the REAL production
 * prompts on each candidate model. A dry run only estimates cost (no calls,
 * no keys); --run measures latency, tokens, cost, schema validity and whether
 * every id the model returned was one we provided (NEVER INVENT FACTS).
 */

// ─── Task specs: the production prompt + output contract per task ───────────

type TaskSpec<I, O> = {
  task: AITask;
  promptVersion: string;
  system: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  buildMessages(input: I): AIMessage[];
  /** ids in the output that were NOT in the input (should always be empty) */
  unknownIds(input: I, output: O): string[];
};

export type BenchmarkSpec = {
  task: AITask;
  promptVersion: string;
  system: string;
  outputSchema: z.ZodType<unknown>;
  parseInput(raw: unknown): { ok: true; input: unknown } | { ok: false; error: string };
  buildMessages(input: unknown): AIMessage[];
  unknownIds(input: unknown, output: unknown): string[];
};

function defineSpec<I, O>(spec: TaskSpec<I, O>): BenchmarkSpec {
  return {
    task: spec.task,
    promptVersion: spec.promptVersion,
    system: spec.system,
    outputSchema: spec.outputSchema as z.ZodType<unknown>,
    parseInput(raw) {
      const parsed = spec.inputSchema.safeParse(raw);
      return parsed.success ? { ok: true, input: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) };
    },
    buildMessages: (input) => spec.buildMessages(input as I),
    unknownIds: (input, output) => spec.unknownIds(input as I, output as O),
  };
}

const notIn = (allowed: Iterable<string>, ids: Iterable<string>) => {
  const set = new Set(allowed);
  return [...new Set(ids)].filter((id) => !set.has(id));
};

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();

const trendLabelInputSchema: z.ZodType<TrendLabelInput> = z.object({
  clusters: z
    .array(
      z.object({
        key: id,
        headlines: z.array(z.object({ id, title: text(300), publisher: nullableText(120) })).min(1).max(20),
      }),
    )
    .min(1)
    .max(40),
});

const opportunityFields = {
  title: text(300),
  description: nullableText(2000),
  why_now: nullableText(1000),
  angle: nullableText(1000),
  hook: nullableText(500),
  competition: nullableText(200),
  sport: nullableText(100),
};

const scoringInputSchema: z.ZodType<OpportunityScoringInput> = z.object({
  opportunity: z.object({ id, ...opportunityFields, signals: z.array(text(60)).max(20), competition_level: nullableText(40) }),
  sources: z.array(z.object({ id, title: text(300), publisher: nullableText(120) })).max(30),
  doNotScore: z.array(z.enum(AI_SCORED_COMPONENTS)).max(4),
});

const researchInputSchema: z.ZodType<ResearchSuggestInput> = z.object({
  opportunity: z.object(opportunityFields),
  sources: z
    .array(z.object({ id, title: text(300), summary: nullableText(2000), url: z.url(), publisher: nullableText(120) }))
    .max(30),
});

const editorialFormat = z.enum(EDITORIAL_FORMATS.map((f) => f.value) as [EditorialFormat, ...EditorialFormat[]]);

type ScriptFixtureInput = { angle: ScriptAngle; context: StoryPromptContext };
const scriptInputSchema: z.ZodType<ScriptFixtureInput> = z.object({
  angle: z.enum(SCRIPT_ANGLES),
  context: z.object({
    story: z.object({ title: text(300), logline: nullableText(1000), angle: nullableText(1000) }),
    opportunity: z
      .object({
        title: text(300),
        description: nullableText(2000),
        whyNow: nullableText(1000),
        angle: nullableText(1000),
        hook: nullableText(500),
        competition: nullableText(200),
      })
      .nullable(),
    facts: z
      .array(
        z.object({
          id,
          claim: text(1000),
          status: z.enum(["confirmed", "probable", "uncertain"]),
          isCritical: z.boolean(),
          sourceIds: z.array(id).max(20),
        }),
      )
      .max(60),
    sources: z.array(z.object({ id, title: text(300), publisher: nullableText(120) })).max(30),
    quotes: z.array(z.object({ id, speaker: nullableText(120), text: text(1000), sourceId: id.nullable() })).max(20),
    productionFormats: z.array(editorialFormat).max(13),
    language: nullableText(20),
  }),
});

const factCheckInputSchema: z.ZodType<FactCheckAssessInput> = z.object({
  claim: z.object({ text: text(1000), isCritical: z.boolean() }),
  sources: z
    .array(
      z.object({
        id,
        title: text(300),
        publisher: nullableText(120),
        url: z.url(),
        summary: nullableText(2000),
        relation: z.enum(["supports", "contradicts", "mentions"]),
        excerpt: nullableText(1000),
        locator: nullableText(120),
      }),
    )
    .min(1)
    .max(20),
});

export const BENCHMARK_SPECS: Record<AITask, BenchmarkSpec> = {
  discovery: defineSpec({
    task: "discovery",
    promptVersion: TREND_LABEL_PROMPT_VERSION,
    system: TREND_LABEL_SYSTEM,
    inputSchema: trendLabelInputSchema,
    outputSchema: trendLabelOutputSchema,
    buildMessages: buildTrendLabelMessages,
    unknownIds(input, output) {
      const clusters = new Map(input.clusters.map((c) => [c.key, c.headlines.map((h) => h.id)]));
      return output.labels.flatMap((l) => {
        const own = clusters.get(l.cluster);
        if (!own) return [l.cluster];
        return notIn(own, l.source_ids); // a source id must belong to that same cluster
      });
    },
  }),
  scoring: defineSpec({
    task: "scoring",
    promptVersion: OPPORTUNITY_SCORING_PROMPT_VERSION,
    system: OPPORTUNITY_SCORING_SYSTEM,
    inputSchema: scoringInputSchema,
    outputSchema: opportunityScoringOutputSchema,
    buildMessages: buildOpportunityScoringMessages,
    unknownIds: (input, output) =>
      notIn(
        input.sources.map((s) => s.id),
        output.components.flatMap((c) => c.source_ids ?? []),
      ),
  }),
  research: defineSpec({
    task: "research",
    promptVersion: RESEARCH_SUGGEST_PROMPT_VERSION,
    system: RESEARCH_SUGGEST_SYSTEM,
    inputSchema: researchInputSchema,
    outputSchema: researchSuggestOutputSchema,
    buildMessages: buildResearchSuggestMessages,
    unknownIds: (input, output) =>
      notIn(
        input.sources.map((s) => s.id),
        [...output.claims, ...output.timeline, ...output.context].flatMap((e) => e.sourceIds),
      ),
  }),
  script: defineSpec({
    task: "script",
    promptVersion: SCRIPT_PROMPT_VERSION,
    system: SCRIPT_SYSTEM,
    inputSchema: scriptInputSchema,
    outputSchema: scriptOutputSchema,
    // same bounded context the worker sends (lib/scripts/generate.ts applies limitContext once)
    buildMessages: (input) => buildAngleMessages(limitContext(input.context), input.angle),
    unknownIds(input, output) {
      const ctx = limitContext(input.context);
      return [...notIn(ctx.facts.map((f) => f.id), output.facts_used), ...notIn(ctx.quotes.map((q) => q.id), output.quote_ids)];
    },
  }),
  fact_check: defineSpec({
    task: "fact_check",
    promptVersion: FACTCHECK_ASSESS_PROMPT_VERSION,
    system: FACTCHECK_ASSESS_SYSTEM,
    inputSchema: factCheckInputSchema,
    outputSchema: factCheckOutputSchema,
    buildMessages: buildFactCheckMessages,
    unknownIds: (input, output) =>
      notIn(
        input.sources.map((s) => s.id),
        output.sources.map((s) => s.sourceId),
      ),
  }),
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * tests/fixtures/ai/<task>.json — invented, clearly fictional inputs (no real
 * events, people, results or copyrighted text), flagged `"fixture": true`.
 */
export const fixtureFileSchema = z.object({
  fixture: z.literal(true),
  notice: z.string().min(20),
  task: z.enum(AI_TASKS),
  cases: z
    .array(z.object({ id: z.string().min(1).max(64), description: z.string().max(300).optional(), input: z.unknown() }))
    .min(1)
    .max(50),
});

export type BenchmarkCase = {
  id: string;
  description: string | null;
  input: unknown;
  request: { system: string; messages: AIMessage[] };
};

/** Validates a fixture file for `task` and builds each case's real request. Throws with a readable message. */
export function parseFixtureFile(task: AITask, raw: unknown): BenchmarkCase[] {
  const file = fixtureFileSchema.safeParse(raw);
  if (!file.success) throw new Error(`Invalid fixture file: ${z.prettifyError(file.error)}`);
  if (file.data.task !== task) throw new Error(`Fixture file is for "${file.data.task}", not "${task}"`);
  const spec = BENCHMARK_SPECS[task];
  const seen = new Set<string>();
  return file.data.cases.map((c) => {
    if (seen.has(c.id)) throw new Error(`Duplicate fixture case id "${c.id}"`);
    seen.add(c.id);
    const parsed = spec.parseInput(c.input);
    if (!parsed.ok) throw new Error(`Fixture case "${c.id}" does not match the ${task} prompt input: ${parsed.error}`);
    return {
      id: c.id,
      description: c.description ?? null,
      input: parsed.input,
      request: { system: spec.system, messages: spec.buildMessages(parsed.input) },
    };
  });
}

// ─── Options ────────────────────────────────────────────────────────────────

export const DEFAULT_BENCHMARK_MODELS = ["anthropic:claude-haiku-5-5", "anthropic:claude-sonnet-5-5"] as const;
/** --run refuses to start when the upper-bound estimate exceeds this (USD) unless --max-usd is raised */
export const DEFAULT_MAX_RUN_USD = 1;

export type BenchmarkOptions = {
  task: AITask;
  models: ModelRef[];
  run: boolean;
  write: boolean;
  limit: number | null;
  repeat: number;
  effort: Effort;
  maxUsd: number;
};

export type RawBenchmarkArgs = {
  task?: string;
  models?: string;
  run?: boolean;
  write?: boolean;
  limit?: string;
  repeat?: string;
  effort?: string;
  "max-usd"?: string;
};

export function resolveBenchmarkOptions(raw: RawBenchmarkArgs): { ok: true; options: BenchmarkOptions } | { ok: false; error: string } {
  const task = raw.task;
  if (!task || !(AI_TASKS as readonly string[]).includes(task)) {
    return { ok: false, error: `--task is required: one of ${AI_TASKS.join(", ")}` };
  }
  const list = (raw.models ?? DEFAULT_BENCHMARK_MODELS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const models: ModelRef[] = [];
  for (const m of list) {
    const ref = parseModelRef(m);
    if (!ref) return { ok: false, error: `Invalid model "${m}": use provider:model, e.g. anthropic:claude-haiku-5-5` };
    if (!models.some((x) => x.provider === ref.provider && x.model === ref.model)) models.push(ref);
  }
  if (models.length === 0) return { ok: false, error: "--models needs at least one provider:model" };
  if (models.length > 6) return { ok: false, error: "Compare at most 6 models per run" };

  const int = (v: string | undefined, name: string, min: number, max: number): number | null | string => {
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : `--${name} must be an integer between ${min} and ${max}`;
  };
  const limit = int(raw.limit, "limit", 1, 50);
  if (typeof limit === "string") return { ok: false, error: limit };
  const repeat = int(raw.repeat, "repeat", 1, 10);
  if (typeof repeat === "string") return { ok: false, error: repeat };

  const effort = (raw.effort ?? TASK_DEFAULTS[task as AITask].effort) as Effort;
  if (!(EFFORTS as readonly string[]).includes(effort)) return { ok: false, error: `--effort must be one of ${EFFORTS.join(", ")}` };

  const maxUsd = raw["max-usd"] === undefined ? DEFAULT_MAX_RUN_USD : Number(raw["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd < 0 || maxUsd > 100) return { ok: false, error: "--max-usd must be a number between 0 and 100" };

  return {
    ok: true,
    options: { task: task as AITask, models, run: Boolean(raw.run), write: Boolean(raw.write), limit, repeat: repeat ?? 1, effort, maxUsd },
  };
}

// ─── Cost estimate (dry run) ────────────────────────────────────────────────

/** Current Claude models cache prompts from 512 tokens; shorter system prompts are not cached. */
export const MIN_CACHEABLE_PROMPT_TOKENS = 512;

export function requestTokens(request: { system: string; messages: AIMessage[] }) {
  const system = estimateTokens(request.system);
  const messages = request.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return { system, messages, total: system + messages };
}

export type ModelEstimate = {
  model: string;
  priced: boolean;
  calls: number;
  inputTokens: number;
  typicalOutputTokens: number;
  maxOutputTokens: number;
  /** typical output, no prompt caching */
  typicalUsd: number | null;
  /** typical output, system prompt written to cache once then read (as the worker requests) */
  cachedUsd: number | null;
  /** every call uses the task's full output cap — the batch guard's bound */
  upperBoundUsd: number | null;
  per100CallsUsd: number | null;
  /** typicalUsd ÷ the cheapest priced model's */
  vsCheapest: number | null;
};

const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

export function estimateModels(task: AITask, cases: readonly BenchmarkCase[], models: readonly ModelRef[], repeat = 1): ModelEstimate[] {
  const typicalOut = TYPICAL_CALL[task].outputTokens;
  const maxOut = TASK_DEFAULTS[task].maxOutputTokens;
  const calls = cases.flatMap((c) => Array.from({ length: repeat }, () => requestTokens(c.request)));

  const rows = models.map((ref): ModelEstimate => {
    const add = (acc: number | null, v: number | null) => (acc === null || v === null ? null : acc + v);
    let typical: number | null = 0;
    let cached: number | null = 0;
    let upper: number | null = 0;
    for (const [i, t] of calls.entries()) {
      const plain = { inputTokens: t.total, cacheReadTokens: 0, cacheWriteTokens: 0 };
      typical = add(typical, costFor(ref.model, { ...plain, outputTokens: typicalOut }));
      upper = add(upper, costFor(ref.model, { ...plain, outputTokens: maxOut }));
      const cacheable = t.system >= MIN_CACHEABLE_PROMPT_TOKENS;
      cached = add(
        cached,
        costFor(ref.model, {
          inputTokens: cacheable ? t.messages : t.total,
          outputTokens: typicalOut,
          cacheReadTokens: cacheable && i > 0 ? t.system : 0,
          cacheWriteTokens: cacheable && i === 0 ? t.system : 0,
        }),
      );
    }
    const n = calls.length;
    const typicalUsd = typical === null ? null : round6(typical);
    return {
      model: formatModelRef(ref),
      priced: typicalUsd !== null,
      calls: n,
      inputTokens: calls.reduce((s, t) => s + t.total, 0),
      typicalOutputTokens: typicalOut * n,
      maxOutputTokens: maxOut * n,
      typicalUsd,
      cachedUsd: cached === null ? null : round6(cached),
      upperBoundUsd: upper === null ? null : round6(upper),
      per100CallsUsd: typicalUsd === null || n === 0 ? null : round6((typicalUsd / n) * 100),
      vsCheapest: null,
    };
  });

  const cheapest = Math.min(...rows.filter((r) => r.typicalUsd !== null && r.typicalUsd > 0).map((r) => r.typicalUsd as number));
  return rows.map((r) => ({
    ...r,
    vsCheapest: r.typicalUsd !== null && Number.isFinite(cheapest) ? Math.round((r.typicalUsd / cheapest) * 10) / 10 : null,
  }));
}

/** Sum of upper bounds; null when any compared model is unpriced. */
export function totalUpperBound(estimates: readonly ModelEstimate[]): number | null {
  let total = 0;
  for (const e of estimates) {
    if (e.upperBoundUsd === null) return null;
    total += e.upperBoundUsd;
  }
  return round6(total);
}

// ─── Measured run ───────────────────────────────────────────────────────────

export type CallRecord = {
  caseId: string;
  model: string;
  /** ok = schema-valid output; invalid_output = output failed the schema (or was truncated); error = no usable answer */
  status: "ok" | "invalid_output" | "error";
  errorKind: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  /** ids in a schema-valid output that were not provided (empty = grounded) */
  unknownIds: string[];
};

export type RunBenchmarkOptions = {
  task: AITask;
  cases: readonly BenchmarkCase[];
  models: readonly ModelRef[];
  providers: Partial<Record<AIProviderId, AIProvider>>;
  effort: Effort;
  repeat?: number;
  /** progress callback (one per call) */
  onRecord?: (record: CallRecord, repeatIndex: number) => void;
};

/**
 * Calls every model on every case through createAIRouter with a SINGLE-MODEL
 * chain (no fallback), sequentially, so each record belongs to that model.
 * Same request shape as the worker: production prompt, cached system prompt,
 * the task's output cap; usage/cost come from the router's ledger events.
 */
export async function runBenchmarkCalls(opts: RunBenchmarkOptions): Promise<CallRecord[]> {
  const spec = BENCHMARK_SPECS[opts.task];
  const repeat = opts.repeat ?? 1;
  const records: CallRecord[] = [];

  for (const ref of opts.models) {
    const model = formatModelRef(ref);
    const events: UsageEvent[] = [];
    const router = createAIRouter({
      providers: opts.providers,
      resolveConfig: (task) => ({
        task,
        primary: ref,
        fallbacks: [],
        effort: opts.effort,
        maxOutputTokens: TASK_DEFAULTS[task].maxOutputTokens,
        source: "default",
      }),
      onUsage: (event) => void events.push(event),
    });

    for (const c of opts.cases) {
      for (let r = 0; r < repeat; r += 1) {
        const seen = events.length;
        const started = Date.now();
        let status: CallRecord["status"] = "ok";
        let errorKind: string | null = null;
        let unknownIds: string[] = [];
        try {
          const res = await router.generateObject(opts.task, { ...c.request, cacheSystemPrompt: true }, spec.outputSchema);
          unknownIds = spec.unknownIds(c.input, res.data);
        } catch (e) {
          errorKind = e instanceof AIError ? (e.attempts?.find((a) => a.errorKind)?.errorKind ?? e.kind) : "unknown";
          status = errorKind === "invalid_output" || errorKind === "truncated" ? "invalid_output" : "error";
        }
        const event = events.slice(seen).at(-1);
        const usage = event?.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        const record: CallRecord = {
          caseId: c.id,
          model,
          status,
          errorKind,
          latencyMs: event?.latencyMs ?? Date.now() - started,
          ...usage,
          costUsd: event?.costUsd ?? null,
          unknownIds,
        };
        records.push(record);
        opts.onRecord?.(record, r);
      }
    }
  }
  return records;
}

export type ModelRunSummary = {
  model: string;
  calls: number;
  ok: number;
  invalidOutput: number;
  errors: number;
  errorKinds: Record<string, number>;
  /** ok ÷ (ok + invalid_output); null when no call returned output */
  schemaValidRate: number | null;
  /** schema-valid outputs whose ids were all provided ÷ schema-valid outputs */
  idsValidRate: number | null;
  latencyAvgMs: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  totalCostUsd: number | null;
  per100CallsUsd: number | null;
  unpricedCalls: number;
};

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarizeModelRuns(model: string, records: readonly CallRecord[]): ModelRunSummary {
  const mine = records.filter((r) => r.model === model);
  const ok = mine.filter((r) => r.status === "ok");
  const invalid = mine.filter((r) => r.status === "invalid_output").length;
  const errors = mine.filter((r) => r.status === "error");
  const errorKinds: Record<string, number> = {};
  for (const r of mine) if (r.status !== "ok" && r.errorKind) errorKinds[r.errorKind] = (errorKinds[r.errorKind] ?? 0) + 1;

  const answered = mine.filter((r) => r.status !== "error");
  const priced = mine.filter((r) => r.costUsd !== null);
  const unpricedCalls = mine.filter((r) => r.costUsd === null && r.inputTokens + r.outputTokens > 0).length;
  const totalCost = unpricedCalls > 0 ? null : round6(priced.reduce((s, r) => s + (r.costUsd ?? 0), 0));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const latencies = answered.map((r) => r.latencyMs);
  const tokensIn = answered.map((r) => r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens);

  return {
    model,
    calls: mine.length,
    ok: ok.length,
    invalidOutput: invalid,
    errors: errors.length,
    errorKinds,
    schemaValidRate: answered.length ? ok.length / answered.length : null,
    idsValidRate: ok.length ? ok.filter((r) => r.unknownIds.length === 0).length / ok.length : null,
    latencyAvgMs: avg(latencies),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    avgInputTokens: avg(tokensIn),
    avgOutputTokens: avg(answered.map((r) => r.outputTokens)),
    totalCostUsd: totalCost,
    per100CallsUsd: totalCost === null || mine.length === 0 ? null : round6((totalCost / mine.length) * 100),
    unpricedCalls,
  };
}

/** Minimum schema-valid and grounded rate for a model to be recommended. */
export const MIN_QUALITY_RATE = 0.95;

/**
 * Cheapest-first: the cheapest priced model whose schema-valid AND grounded
 * rates reach MIN_QUALITY_RATE. A human still reads the outputs and decides.
 */
export function recommendModel(summaries: readonly ModelRunSummary[], minRate = MIN_QUALITY_RATE): ModelRunSummary | null {
  const qualified = summaries.filter(
    (s) => s.per100CallsUsd !== null && (s.schemaValidRate ?? 0) >= minRate && (s.idsValidRate ?? 0) >= minRate,
  );
  qualified.sort((a, b) => (a.per100CallsUsd as number) - (b.per100CallsUsd as number));
  return qualified[0] ?? null;
}

// ─── Markdown report ────────────────────────────────────────────────────────

export function benchmarkReportName(date: string, task: AITask, kind: "run" | "estimate"): string {
  return kind === "run" ? `${date}-${task}.md` : `${date}-${task}-estimate.md`;
}

function usd(v: number | null): string {
  if (v === null) return "unpriced";
  if (v === 0) return "$0";
  if (v < 0.0001) return "<$0.0001";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}%`);
const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)} s`);
const n = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat("en-US").format(v));

export type ReportMeta = {
  date: string;
  task: AITask;
  fixtureFile: string;
  cases: number;
  repeat: number;
  effort: Effort;
};

function header(meta: ReportMeta, title: string): string[] {
  const spec = BENCHMARK_SPECS[meta.task];
  return [
    `# ${title}: ${meta.task} (${meta.date})`,
    "",
    `- Task: \`${meta.task}\` · prompt \`${spec.promptVersion}\` · effort \`${meta.effort}\` · output cap ${n(TASK_DEFAULTS[meta.task].maxOutputTokens)} tokens`,
    `- Inputs: ${meta.cases} fixture case(s) × ${meta.repeat} from \`${meta.fixtureFile}\` (invented, clearly fictional data — not real events)`,
    `- Prices: \`lib/ai/pricing.ts\` (as of ${PRICES_AS_OF}); unknown models are "unpriced", never guessed`,
    "",
  ];
}

export function renderEstimateMarkdown(meta: ReportMeta, estimates: readonly ModelEstimate[]): string {
  const typicalOut = TYPICAL_CALL[meta.task].outputTokens;
  return [
    ...header(meta, "AI cost estimate (dry run, no API calls)"),
    "Input tokens are estimated from the real prompts (≈ 4 characters per token). Output is an assumption",
    `(${n(typicalOut)} tokens per call, thinking included) — measure with \`--run\` before deciding.`,
    "",
    "| Model | Calls | Input tokens | Typical cost | With prompt cache | Upper bound (full output cap) | Per 100 calls | × cheapest |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...estimates.map(
      (e) =>
        `| \`${e.model}\` | ${e.calls} | ${n(e.inputTokens)} | ${usd(e.typicalUsd)} | ${usd(e.cachedUsd)} | ${usd(e.upperBoundUsd)} | ${usd(e.per100CallsUsd)} | ${e.vsCheapest === null ? "—" : `×${e.vsCheapest}`} |`,
    ),
    "",
  ].join("\n");
}

export function renderRunMarkdown(
  meta: ReportMeta,
  estimates: readonly ModelEstimate[],
  summaries: readonly ModelRunSummary[],
  records: readonly CallRecord[],
): string {
  const best = recommendModel(summaries);
  const problems = records.filter((r) => r.status !== "ok" || r.unknownIds.length > 0);
  return [
    ...header(meta, "AI benchmark"),
    "## Measured",
    "",
    "| Model | Calls | Schema-valid | Grounded ids | Errors | Latency avg / p50 / p95 | Avg tokens in / out | Total cost | Per 100 calls |",
    "|---|---:|---:|---:|---:|---|---|---:|---:|",
    ...summaries.map(
      (s) =>
        `| \`${s.model}\` | ${s.calls} | ${pct(s.schemaValidRate)} | ${pct(s.idsValidRate)} | ${s.errors}${
          Object.keys(s.errorKinds).length ? ` (${Object.entries(s.errorKinds).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""
        } | ${ms(s.latencyAvgMs)} / ${ms(s.latencyP50Ms)} / ${ms(s.latencyP95Ms)} | ${n(s.avgInputTokens)} / ${n(s.avgOutputTokens)} | ${usd(
          s.totalCostUsd,
        )} | ${usd(s.per100CallsUsd)} |`,
    ),
    "",
    "Schema-valid: output parsed and matched the production zod schema. Grounded ids: every source/fact/quote id the",
    "model returned was one we provided (the app drops anything else — NEVER INVENT FACTS).",
    "",
    "## Estimate before the run",
    "",
    "| Model | Typical cost | Upper bound |",
    "|---|---:|---:|",
    ...estimates.map((e) => `| \`${e.model}\` | ${usd(e.typicalUsd)} | ${usd(e.upperBoundUsd)} |`),
    "",
    "## Cheapest-first suggestion",
    "",
    best
      ? `\`${best.model}\` is the cheapest model with ≥ ${MIN_QUALITY_RATE * 100}% schema-valid and grounded outputs on these fixtures (${usd(best.per100CallsUsd)} per 100 calls).`
      : `No priced model reached ${MIN_QUALITY_RATE * 100}% schema-valid and grounded outputs on these fixtures: keep the current default and review the failures below.`,
    "",
    "This is a suggestion from fixtures, not a decision: read a sample of the outputs, then record the decision below.",
    "",
    "## Calls needing attention",
    "",
    ...(problems.length
      ? [
          "| Case | Model | Status | Error | Unknown ids |",
          "|---|---|---|---|---|",
          ...problems.map(
            (r) => `| ${r.caseId} | \`${r.model}\` | ${r.status} | ${r.errorKind ?? "—"} | ${r.unknownIds.length ? r.unknownIds.join(", ") : "—"} |`,
          ),
        ]
      : ["None."]),
    "",
    "## Decision",
    "",
    "_To be filled in by a person: chosen model per task, reason, and the Settings/env change made._",
    "",
  ].join("\n");
}
