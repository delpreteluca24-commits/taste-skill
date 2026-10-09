import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { modelSuggestions, presentAllTaskRouting } from "@/components/settings/ai-routing";
import { ModelSuggestionList, TaskRoutingRows } from "@/components/settings/ai-routing-fields";
import { summarizeUsage } from "@/components/settings/ai-usage";
import { AiUsagePanel } from "@/components/settings/ai-usage-panel";
import { CostControlExplainer } from "@/components/settings/cost-control-explainer";
import { resetPricingOverrides } from "@/lib/ai/pricing";
import { SUGGESTED_MODELS } from "@/lib/settings/schema";

/** Settings → AI presentational pieces: status always as icon + text, never color alone. */

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

beforeEach(() => {
  delete process.env.AI_PRICING_JSON;
  resetPricingOverrides();
});

describe("per-task routing rows", () => {
  it("render one row per task with the effective model, source, price and labelled inputs", () => {
    const routing = presentAllTaskRouting(
      { scoring: { model: "anthropic:claude-sonnet-5-5", effort: "medium" }, script: { model: "openai:gpt-test" } },
      { RESEARCH_MODEL: "anthropic:claude-opus-5-5" },
      { anthropic: true, openai: false },
    );
    const out = html(createElement(TaskRoutingRows, { routing, errors: { "tasks.script.model": ["Use \"provider:model\""] } }));

    for (const task of ["discovery", "scoring", "research", "script", "fact_check"]) expect(out).toContain(`data-testid="ai-task-${task}"`);
    // discovery: code default
    expect(out).toMatch(/data-testid="ai-task-discovery-model">anthropic:claude-haiku-5-5<\/code>.*?Default/s);
    // scoring: Settings override, 20× the default on a batch task → measure-first warning with the command
    expect(out).toMatch(/data-testid="ai-task-scoring-model">anthropic:claude-sonnet-5-5<\/code>.*?Settings/s);
    expect(out).toContain("×20 the cost of the default (anthropic:claude-haiku-5-5) on a batch");
    expect(out).toContain("npm run ai:benchmark -- --task scoring");
    // research: from the env var
    expect(out).toContain("Env · RESEARCH_MODEL");
    // script: unpriced model, provider without key, per-field error
    expect(out).toContain("Unpriced — cost not tracked");
    expect(out).toContain("No openai API key — calls are skipped");
    expect(out).toContain("Use &quot;provider:model&quot;");
    // inputs: names the action reads, inherit placeholders, accessible per-task labels
    expect(out).toContain('name="tasks.fact_check.model"');
    expect(out).toContain('name="tasks.fact_check.fallback"');
    expect(out).toContain('name="tasks.fact_check.effort"');
    expect(out).toContain('placeholder="Inherit · anthropic:claude-sonnet-5-5"');
    expect(out).toMatch(/<label[^>]*for="ai-fact_check-model"[^>]*>Model override<span class="sr-only"> for Fact check<\/span>/);
    expect(out).toContain("Inherit (high)");
    expect(out).toContain("$0.10 / $0.50");
  });

  it("offers model suggestions with prices in a datalist", () => {
    const out = html(createElement(ModelSuggestionList, { suggestions: modelSuggestions(SUGGESTED_MODELS) }));
    expect(out).toContain('<datalist id="ai-model-suggestions">');
    expect(out).toContain('value="anthropic:claude-haiku-5-5" label="$0.10 / $0.50 per 1M tokens (in / out)"');
  });
});

describe("AI usage panel", () => {
  it("says where data comes from when the ledger is empty", () => {
    expect(html(createElement(AiUsagePanel, { summary: summarizeUsage([]) }))).toContain(
      "No AI calls yet — the worker logs every call here",
    );
  });

  it("shows an error instead of fake numbers when loading failed", () => {
    expect(html(createElement(AiUsagePanel, { summary: null }))).toMatch(/role="alert".*Could not load AI usage/);
  });

  it("lists task × model rows with totals and marks unpriced cost explicitly", () => {
    const summary = summarizeUsage([
      { task: "scoring", provider: "anthropic", model: "claude-haiku-5-5", calls: 12, errors: 2, inputTokens: 8400, outputTokens: 5400, costUsd: 0.00354 },
      { task: "script", provider: "openai", model: "gpt-test", calls: 3, errors: 0, inputTokens: 4200, outputTokens: 3300, costUsd: null },
    ]);
    const out = html(createElement(AiUsagePanel, { summary }));
    expect(out).toContain("Scoring");
    expect(out).toContain("anthropic:claude-haiku-5-5");
    expect(out).toMatch(/Unpriced/);
    expect(out).toContain("+ 3 unpriced calls");
    expect(out).toContain("No price for openai:gpt-test");
    expect(out).toMatch(/Total.*\$0\.0035.*excl\. unpriced/s);
    expect(out).toContain("failed or refused");

    const one = summarizeUsage([{ task: "script", provider: "openai", model: "gpt-test", calls: 1, errors: 0, inputTokens: 10, outputTokens: 10, costUsd: null }]);
    expect(html(createElement(AiUsagePanel, { summary: one }))).toContain("+ 1 unpriced call<");
  });
});

describe("cost-control explainer", () => {
  it("summarises the policy and points to the repository doc", () => {
    const out = html(createElement(CostControlExplainer));
    for (const text of ["Settings &gt; env &gt; default", "Batch cost guard", "Fallback chain", "ai_usage", "npm run ai:benchmark", "docs/AI_COST_CONTROL.md"]) {
      expect(out).toContain(text);
    }
  });
});
