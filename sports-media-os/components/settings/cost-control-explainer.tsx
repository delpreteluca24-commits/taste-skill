import { FlaskConical, Gauge, ReceiptText, Route, ShieldCheck, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * "How AI cost is controlled" — an inline summary of docs/AI_COST_CONTROL.md
 * (the full policy lives in the repository).
 */

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Route,
    title: "Cheapest model that fits, per task",
    body: "Haiku for high-volume discovery and scoring; Sonnet for research, scripts and fact checks. Opus and Fable are opt-in per task, never automatic.",
  },
  {
    icon: Workflow,
    title: "Settings > env > default",
    body: "An override here wins over DISCOVERY_MODEL … FACT_CHECK_MODEL in the server env, which win over the code defaults. Empty field = inherit.",
  },
  {
    icon: ShieldCheck,
    title: "Fallback chain",
    body: "Primary → task fallback → AI_FALLBACK_MODEL. Providers without a key are skipped at no cost; errors, refusals and invalid output move to the next model.",
  },
  {
    icon: Gauge,
    title: "Batch cost guard",
    body: "Batch jobs estimate an upper bound first. Above the limit, or with an unpriced model, a person confirms the amount; the worker stops at that budget.",
  },
  {
    icon: ReceiptText,
    title: "Every call in the ledger",
    body: "The worker logs each call (task, model, tokens, cost, latency, status) to ai_usage. Unknown prices stay null — never guessed. AI never runs in a web request.",
  },
  {
    icon: FlaskConical,
    title: "Measure before upgrading",
    body: "Before a batch task uses a pricier model: run npm run ai:benchmark on the fixtures, compare cost and validity, document the result, keep the cheaper model if quality holds.",
  },
];

export function CostControlExplainer() {
  return (
    <div className="grid gap-3" data-testid="ai-cost-explainer">
      <ul className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-2.5">
            <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium">{title}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Full policy, defaults rationale and the benchmark procedure: <code className="text-foreground">docs/AI_COST_CONTROL.md</code>{" "}
        in the repository. Reports: <code className="text-foreground">docs/ai-benchmarks/</code>.
      </p>
    </div>
  );
}
