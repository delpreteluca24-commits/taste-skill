import type { DbErrorLike } from "@/lib/db/errors";
import { parseGuardError, toUserMessage } from "@/lib/db/errors";

import type { ScriptState } from "./board";
import { READY_GATE_STAGES, SCRIPT_GATE_STAGES } from "./board";
import { STAGE_LABELS, type ContentStage } from "./stages";

/**
 * Content gates explained (pure). The database is the authority: the READY
 * blockers come from rpc content_item_blockers (the same function the trigger
 * uses) and the gate errors from the triggers. This file only turns them into
 * explanations and next steps; it never decides whether a move is allowed.
 */

export type BlockerKind = "facts" | "clips" | "other";

export type BlockerExplanation = {
  kind: BlockerKind;
  /** the blocker as the database reports it */
  text: string;
  count: number | null;
  title: string;
  explanation: string;
  action: { label: string; href: string } | null;
};

const FACTS = /^(\d+)\s+critical fact\(s\) not confirmed/i;
const CLIPS = /^(\d+)\s+clip\(s\)\s+use material/i;

/** One rpc content_item_blockers entry → what it means and where to fix it. */
export function explainBlocker(text: string, ctx: { opportunityId: string | null }): BlockerExplanation {
  const facts = FACTS.exec(text);
  if (facts) {
    const count = Number(facts[1]);
    return {
      kind: "facts",
      text,
      count,
      title: `${count} critical claim${count === 1 ? "" : "s"} not confirmed`,
      explanation:
        "Every critical claim of this item, its story or its opportunity must be confirmed by a person against at least one supporting source. " +
        "Probable, uncertain and false critical claims all block READY. A claim that cannot be verified must not be stated as fact: " +
        "reword it as an open question or take it out of the script. " +
        (ctx.opportunityId
          ? "Confirm or update each claim in the research workspace."
          : "This item started as an idea, so it has no research workspace; the claims are listed below."),
      action: ctx.opportunityId
        ? { label: "Open claims in research", href: `/research/${ctx.opportunityId}?tab=claims` }
        : null,
    };
  }
  const clips = CLIPS.exec(text);
  if (clips) {
    const count = Number(clips[1]);
    return {
      kind: "clips",
      text,
      count,
      title: `${count} clip${count === 1 ? "" : "s"} use material not cleared for production`,
      explanation:
        "A clip cut from a video that is RED, unchecked, or YELLOW without a person's rights approval can never ship. " +
        "Classify the source video in the Rights Center (YELLOW needs a human approval), reject the clip, or switch to an original format below.",
      action: { label: "Open Rights Center", href: "/rights" },
    };
  }
  return { kind: "other", text, count: null, title: text, explanation: "Reported by the READY gate in the database.", action: null };
}

export type GateState = "open" | "closed";

export type GateView = {
  key: "script" | "ready";
  label: string;
  state: GateState;
  /** stages guarded by this gate */
  appliesTo: string;
  detail: string;
};

/**
 * The two DB gates in front of the item, as the UI explains them:
 * SCRIPT gate (PRODUCTION and later) and READY gate (READY/SCHEDULED/PUBLISHED).
 */
export function gateViews(input: { script: ScriptState; blockers: readonly string[] }): GateView[] {
  const scriptDetail: Record<ScriptState, string> = {
    approved: "The current script is approved.",
    pending: "The current script is waiting for a person's decision (Script tab).",
    rejected: "The current script was rejected: write or generate a new version and approve it.",
    missing: "The story has no script yet: create one in the Script tab, then approve it.",
    no_story: "No story linked: create the story, write its script and approve it.",
  };
  const n = input.blockers.length;
  return [
    {
      key: "script",
      label: "Script gate",
      state: input.script === "approved" ? "open" : "closed",
      appliesTo: SCRIPT_GATE_STAGES.map((s) => STAGE_LABELS[s]).join(", "),
      detail: scriptDetail[input.script],
    },
    {
      key: "ready",
      label: "READY gate",
      state: n === 0 && input.script === "approved" ? "open" : "closed",
      appliesTo: READY_GATE_STAGES.map((s) => STAGE_LABELS[s]).join(", "),
      detail:
        n === 0
          ? input.script === "approved"
            ? "No blockers: critical claims are confirmed and no clip uses uncleared material."
            : "No claim or clip blockers, but the script gate is closed."
          : `${n} blocker${n === 1 ? "" : "s"} listed below.`,
    },
  ];
}

/**
 * User-safe message for a refused move. DB guard codes are mapped by
 * toUserMessage; a missing story gets a more precise next step.
 */
export function moveErrorMessage(error: DbErrorLike, target?: ContentStage): string {
  const guard = parseGuardError(error);
  if (guard?.code === "SCRIPT_NOT_APPROVED" && /link a story/i.test(guard.detail)) {
    return "Create the story and approve its current script before moving to production.";
  }
  if (guard?.code === "CONTENT_NOT_READY") {
    const where = target ? STAGE_LABELS[target].toUpperCase() : "READY";
    return `Can't move to ${where}: ${guard.detail}. Resolve the blockers on the item page first.`;
  }
  return toUserMessage(error, "Could not move the item. Please retry.");
}
