import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionBadge, FactChips, HookScoreBadge, HookTypeBadge, OperationBadge, ScriptSectionsView, WarningsPanel } from "@/components/scripts/badges";
import { GenerateHooksButton, ManualHookForm, SelectHookButton } from "@/components/scripts/hook-controls";
import {
  GenerateAnglesForm,
  MakeCurrentButton,
  ManualVersionEditor,
  ScriptDecisionForm,
  TransformControls,
} from "@/components/scripts/script-controls";
import { parseWarning } from "@/lib/scripts/grounding";

/** Presentational pieces of the studios render status with icon + text (never color alone). */

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("studio badges", () => {
  it("decision, operation and hook badges carry a text label", () => {
    expect(html(createElement(DecisionBadge, { decision: null }))).toContain("Awaiting approval");
    expect(html(createElement(DecisionBadge, { decision: "approved" }))).toMatch(/data-decision="approved".*Approved/);
    expect(html(createElement(DecisionBadge, { decision: "rejected" }))).toContain("Rejected");
    expect(html(createElement(OperationBadge, { operation: "rewrite_hook" }))).toContain("Hook rewritten");
    expect(html(createElement(HookTypeBadge, { type: "statistical" }))).toContain("Statistical");
  });

  it("hook score shows the number and its band in words", () => {
    expect(html(createElement(HookScoreBadge, { score: 82 }))).toMatch(/82.*strong/);
    expect(html(createElement(HookScoreBadge, { score: 55 }))).toMatch(/55.*fair/);
    expect(html(createElement(HookScoreBadge, { score: 20 }))).toMatch(/20.*weak/);
    expect(html(createElement(HookScoreBadge, { score: null }))).toContain("not scored");
  });

  it("renders the six sections in order, marking empty ones", () => {
    const out = html(
      createElement(ScriptSectionsView, { sections: { hook: "H1", context: "C1", escalation: "", reveal: "R1", payoff: "P1", cta: "CTA1" } }),
    );
    const order = ["Hook", "Context", "Escalation", "Reveal", "Payoff", "CTA"].map((label) => out.indexOf(`>${label}<`));
    expect(order.every((i, k) => i > -1 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(out).toContain("Empty");
  });

  it("lists grounding warnings with their labels, or says the check is clean", () => {
    const warnings = ["ungrounded_number: “5” is not in any provided fact.", "missing_info: Attendance figure"].map(parseWarning);
    const out = html(createElement(WarningsPanel, { warnings }));
    expect(out).toContain("Check before approving");
    expect(out).toContain("Number not in facts");
    expect(out).toContain("Missing information");
    expect(html(createElement(WarningsPanel, { warnings: [] }))).toContain("no warnings");
  });

  it("shows each cited fact with its current status, and removed claims", () => {
    const out = html(
      createElement(FactChips, {
        ids: ["f1", "gone"],
        facts: { f1: { id: "f1", claim: "Bologna beat Inter 3-0", status: "probable", isCritical: true } },
      }),
    );
    expect(out).toContain("Probable: ");
    expect(out).toContain("Bologna beat Inter 3-0");
    expect(out).toContain("Removed claim");
    expect(html(createElement(FactChips, { ids: [], facts: {} }))).toContain("Cites no research facts");
  });
});

describe("studio controls (server render)", () => {
  it("pre-selects three angles and offers every rewrite as a new version", () => {
    const form = html(createElement(GenerateAnglesForm, { storyId: "s", activeJobId: null, hasVersions: false }));
    expect(form).toContain("Generate 3 angles");
    expect(form.match(/checked=""/g)).toHaveLength(3);
    const transforms = html(createElement(TransformControls, { scriptId: "x", version: 2, activeJobId: null }));
    for (const label of ["Regenerate", "Shorten", "Expand", "Rewrite hook", "Change tone"]) expect(transforms).toContain(label);
    expect(html(createElement(MakeCurrentButton, { scriptId: "x", version: 3 }))).toContain("Make v3 current");
  });

  it("asks the approver to check grounding warnings", () => {
    const approval = html(createElement(ScriptDecisionForm, { scriptId: "x", version: 2, latest: null, warningCount: 2 }));
    expect(approval).toContain("2 grounding warnings");
    expect(approval).toContain("Approve v2");
  });

  it("manual editor has the six labelled sections; hook controls render", () => {
    const editor = html(createElement(ManualVersionEditor, { storyId: "s", initial: null, tone: null, baseVersion: null }));
    for (const label of ["Hook", "Context", "Escalation", "Reveal", "Payoff", "CTA", "Angle"]) expect(editor).toContain(`>${label}</label>`);
    expect(html(createElement(GenerateHooksButton, { storyId: "s", activeJobId: null, factCount: 0 }))).toContain("Generate 5 hooks");
    expect(html(createElement(ManualHookForm, { storyId: "s" }))).toContain("Add hook");
    expect(html(createElement(SelectHookButton, { hookId: "h", selected: true }))).toContain("Clear selection");
  });
});
