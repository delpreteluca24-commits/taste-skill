/**
 * AI benchmark — MEASURE → COMPARE → DOCUMENT → CHEAPER FIRST (docs/AI_COST_CONTROL.md).
 *
 *   npm run ai:benchmark -- --task scoring
 *   npm run ai:benchmark -- --task scoring --models anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5
 *   npm run ai:benchmark -- --task scoring --models … --run [--repeat 2] [--max-usd 0.50]
 *
 * Inputs: tests/fixtures/ai/<task>.json (invented, clearly fictional), sent
 * through the REAL production prompt and output schema of that task.
 *
 * Default = DRY RUN: estimates cost per model (no API calls, no keys needed).
 *   --write  also saves the estimate to docs/ai-benchmarks/<date>-<task>-estimate.md
 * --run: calls each model through createAIRouter with a single-model chain (no
 *   fallback, so every number belongs to that model) and reports latency,
 *   tokens, cost, schema-valid rate and grounded-id rate, then writes
 *   docs/ai-benchmarks/<date>-<task>.md. It refuses to start when the
 *   upper-bound estimate exceeds --max-usd (default $1).
 *
 * Benchmark calls are not written to the ai_usage ledger (no project); their
 * cost is in the report. Keys come from .env.local / the environment.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

// env must be loaded before the AI modules read it
const { formatModelRef } = await import("@/lib/ai/models");
const { createAnthropicProvider } = await import("@/lib/ai/providers/anthropic");
const { createOpenAIProvider } = await import("@/lib/ai/providers/openai");
const bench = await import("@/components/settings/benchmark");

const USAGE = `Usage: npm run ai:benchmark -- --task <${Object.keys(bench.BENCHMARK_SPECS).join("|")}> [--models a:m1,a:m2] [--run] [--write]
                                [--limit N] [--repeat N] [--effort low|medium|high|xhigh|max] [--max-usd USD]`;

function exit(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    models: { type: "string" },
    run: { type: "boolean", default: false },
    write: { type: "boolean", default: false },
    limit: { type: "string" },
    repeat: { type: "string" },
    effort: { type: "string" },
    "max-usd": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const resolved = bench.resolveBenchmarkOptions(values);
if (!resolved.ok) exit(`${resolved.error}\n${USAGE}`);
const opts = resolved.options;

// ─── Fixtures ───
const fixtureRel = `tests/fixtures/ai/${opts.task}.json`;
const fixtureUrl = new URL(`../${fixtureRel}`, import.meta.url);
if (!existsSync(fixtureUrl)) exit(`No fixtures for "${opts.task}": create ${fixtureRel}`);
let cases: import("@/components/settings/benchmark").BenchmarkCase[];
try {
  cases = bench.parseFixtureFile(opts.task, JSON.parse(readFileSync(fixtureUrl, "utf8")));
} catch (e) {
  exit(e instanceof Error ? e.message : String(e));
}
if (opts.limit) cases = cases.slice(0, opts.limit);

const date = new Date().toISOString().slice(0, 10);
const meta = { date, task: opts.task, fixtureFile: fixtureRel, cases: cases.length, repeat: opts.repeat, effort: opts.effort };
const estimates = bench.estimateModels(opts.task, cases, opts.models, opts.repeat);

console.log(bench.renderEstimateMarkdown(meta, estimates));

function save(name: string, markdown: string): string {
  const dir = new URL("../docs/ai-benchmarks/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  let file = new URL(name, dir);
  // never overwrite an earlier report from the same day
  for (let i = 2; existsSync(file); i += 1) file = new URL(name.replace(/\.md$/, `-${i}.md`), dir);
  writeFileSync(file, markdown);
  return `docs/ai-benchmarks/${file.pathname.split("/").pop()}`;
}

if (!opts.run) {
  if (opts.write) console.log(`✔ Estimate saved to ${save(bench.benchmarkReportName(date, opts.task, "estimate"), bench.renderEstimateMarkdown(meta, estimates))}`);
  console.log("Dry run: no API calls were made. Add --run to measure (needs the provider API keys).");
  process.exit(0);
}

// ─── Measured run ───
const providers = { anthropic: createAnthropicProvider(), openai: createOpenAIProvider() };
for (const ref of opts.models) {
  if (!providers[ref.provider].isConfigured()) {
    exit(`${ref.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} is not set: --run needs a key for every compared model. The dry run works without keys.`);
  }
}
const bound = bench.totalUpperBound(estimates);
if (bound === null) exit("An unpriced model is in the comparison: add its price to AI_PRICING_JSON before --run, so the spend can be bounded.");
if (bound > opts.maxUsd) exit(`Upper-bound cost $${bound.toFixed(4)} exceeds --max-usd $${opts.maxUsd}. Lower --limit/--repeat or raise --max-usd.`);

const records = await bench.runBenchmarkCalls({
  task: opts.task,
  cases,
  models: opts.models,
  providers,
  effort: opts.effort,
  repeat: opts.repeat,
  onRecord(record, r) {
    const tokensIn = record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens;
    const mark = record.status !== "ok" ? "✖" : record.unknownIds.length ? "!" : "✔";
    console.log(
      `${mark} ${record.model} · ${record.caseId}${opts.repeat > 1 ? ` #${r + 1}` : ""} · ${record.status}${
        record.errorKind ? ` (${record.errorKind})` : ""
      }${record.unknownIds.length ? ` · unknown ids: ${record.unknownIds.join(", ")}` : ""} · ${record.latencyMs} ms · ${tokensIn}/${record.outputTokens} tokens`,
    );
  },
});

const summaries = opts.models.map((ref) => bench.summarizeModelRuns(formatModelRef(ref), records));
const report = bench.renderRunMarkdown(meta, estimates, summaries, records);
console.log(`\n${report}`);
console.log(`✔ Report saved to ${save(bench.benchmarkReportName(date, opts.task, "run"), report)} — fill in the Decision section.`);
