import { describe, expect, it } from "vitest";

import { explainBlocker, gateViews, moveErrorMessage } from "@/lib/content/blockers";
import {
  applyMove,
  cardView,
  compareItems,
  countByStage,
  groupByStage,
  planPosition,
  POSITION_STEP,
  scriptState,
  stageAge,
  stageGate,
  type BoardItem,
} from "@/lib/content/board";
import { contentFieldsSchema, moveSchema, parseDetailTab, storyDecisionSchema } from "@/lib/content/schema";
import { CONTENT_STAGE_ORDER } from "@/lib/content/stages";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let seq = 0;
function item(over: Partial<BoardItem> = {}): BoardItem {
  seq += 1;
  return {
    id: over.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    title: `Item ${seq}`,
    format: "short",
    stage: "idea",
    position: 0,
    createdAt: hoursAgo(100 - seq),
    stageChangedAt: hoursAgo(2),
    storyId: null,
    storyTitle: null,
    storyStatus: null,
    opportunityId: null,
    opportunityTitle: null,
    opportunityScore: null,
    scriptId: null,
    scriptVersion: null,
    scriptDecision: null,
    blockers: null,
    ...over,
  };
}

describe("board grouping and order", () => {
  it("returns the nine columns in Kanban order (not the Postgres enum order), empty ones included", () => {
    const cols = groupByStage([item({ stage: "review" }), item({ stage: "production" })]);
    expect(cols.map((c) => c.stage)).toEqual([...CONTENT_STAGE_ORDER]);
    expect(cols.map((c) => c.stage).indexOf("review")).toBeLessThan(cols.map((c) => c.stage).indexOf("production"));
    expect(cols.map((c) => c.label)).toEqual(["Idea", "Research", "Script", "Review", "Production", "Ready", "Scheduled", "Published", "Analyzing"]);
    expect(cols.find((c) => c.stage === "ready")!.items).toEqual([]);
  });

  it("sorts a column by position, then creation time, then id; drops unknown stages", () => {
    const a = item({ id: "a", stage: "script", position: 2048, createdAt: hoursAgo(5) });
    const b = item({ id: "b", stage: "script", position: 1024, createdAt: hoursAgo(1) });
    const c = item({ id: "c", stage: "script", position: 2048, createdAt: hoursAgo(9) });
    const d = item({ id: "d", stage: "script", position: 2048, createdAt: hoursAgo(9) });
    const ghost = { ...item({ id: "ghost" }), stage: "archived" as never };
    const cols = groupByStage([a, b, c, d, ghost]);
    expect(cols.find((col) => col.stage === "script")!.items.map((i) => i.id)).toEqual(["b", "c", "d", "a"]);
    expect(cols.flatMap((col) => col.items).some((i) => i.id === "ghost")).toBe(false);
    expect(compareItems(c, d)).toBeLessThan(0);
  });

  it("counts every stage", () => {
    const counts = countByStage([item({ stage: "idea" }), item({ stage: "idea" }), item({ stage: "ready" })]);
    expect(counts).toMatchObject({ idea: 2, ready: 1, research: 0, analyzing: 0 });
    expect(Object.keys(counts)).toHaveLength(9);
  });
});

describe("drop position", () => {
  const col = (...positions: number[]) => positions.map((position, i) => ({ id: `c${i}`, position }));

  it("uses the midpoint between neighbours", () => {
    expect(planPosition(col(1024, 2048), 1)).toEqual({ position: 1536, rebalance: [] });
  });

  it("goes one step before the first / after the last card, and starts an empty column at one step", () => {
    expect(planPosition(col(1024, 2048), 0)).toEqual({ position: 1024 - POSITION_STEP, rebalance: [] });
    expect(planPosition(col(1024, 2048), 2)).toEqual({ position: 2048 + POSITION_STEP, rebalance: [] });
    expect(planPosition([], 0)).toEqual({ position: POSITION_STEP, rebalance: [] });
  });

  it("clamps out-of-range and missing indexes to the column", () => {
    expect(planPosition(col(10), 99).position).toBe(10 + POSITION_STEP);
    expect(planPosition(col(10), -3).position).toBe(10 - POSITION_STEP);
    expect(planPosition(col(10), Number.NaN).position).toBe(10 + POSITION_STEP);
  });

  it("renumbers the column when neighbours tie (e.g. items created with the default position 0)", () => {
    const plan = planPosition(col(0, 0, 0), 1);
    expect(plan.position).toBe(2 * POSITION_STEP);
    expect(plan.rebalance).toEqual([
      { id: "c0", position: 1 * POSITION_STEP },
      { id: "c1", position: 3 * POSITION_STEP },
      { id: "c2", position: 4 * POSITION_STEP },
    ]);
  });

  it("renumbers when the gap is exhausted and only lists cards whose position changes", () => {
    const plan = planPosition(
      [
        { id: "x", position: 1024 },
        { id: "y", position: 1024 + 1e-7 },
      ],
      1,
    );
    expect(plan.position).toBe(2048);
    expect(plan.rebalance).toEqual([{ id: "y", position: 3072 }]);
  });

  it("renumbers runaway positions", () => {
    const plan = planPosition(col(1e13), 1);
    expect(plan.position).toBe(2 * POSITION_STEP);
    expect(plan.rebalance).toEqual([{ id: "c0", position: POSITION_STEP }]);
  });
});

describe("optimistic move", () => {
  it("moves the card at the drop index, flags it pending, resets stage age and blockers on a stage change", () => {
    const a = item({ id: "a", stage: "review", position: 1024 });
    const b = item({ id: "b", stage: "review", position: 2048 });
    const c = item({ id: "c", stage: "script", position: 1024, blockers: ["1 critical fact(s) not confirmed"], stageChangedAt: hoursAgo(50) });
    const next = applyMove([a, b, c], { id: "c", stage: "review", index: 1 }, NOW.toISOString());
    const moved = next.find((i) => i.id === "c")!;
    expect(moved).toMatchObject({ stage: "review", position: 1536, pending: true, stageChangedAt: NOW.toISOString(), blockers: null });
    expect(groupByStage(next).find((col) => col.stage === "review")!.items.map((i) => i.id)).toEqual(["a", "c", "b"]);
    // the input is not mutated (rollback = the previous array)
    expect(c.stage).toBe("script");
  });

  it("appends at the end of the column without an index; reorders within a column without touching stage age", () => {
    const a = item({ id: "a", stage: "idea", position: 1024 });
    const b = item({ id: "b", stage: "idea", position: 2048, stageChangedAt: hoursAgo(30) });
    const appended = applyMove([a, b], { id: "a", stage: "idea" }, NOW.toISOString());
    expect(appended.find((i) => i.id === "a")!.position).toBe(2048 + POSITION_STEP);
    const reordered = applyMove([a, b], { id: "b", stage: "idea", index: 0 }, NOW.toISOString());
    const movedB = reordered.find((i) => i.id === "b")!;
    expect(movedB.position).toBe(1024 - POSITION_STEP);
    expect(movedB.stageChangedAt).toBe(hoursAgo(30));
  });

  it("renumbers neighbours optimistically when positions tie, and ignores unknown ids", () => {
    const a = item({ id: "a", stage: "research", position: 0 });
    const b = item({ id: "b", stage: "research", position: 0 });
    const x = item({ id: "x", stage: "idea", position: 0 });
    const next = applyMove([a, b, x], { id: "x", stage: "research", index: 1 }, NOW.toISOString());
    expect(groupByStage(next).find((col) => col.stage === "research")!.items.map((i) => i.id)).toEqual(["a", "x", "b"]);
    expect(applyMove([a], { id: "nope", stage: "ready" }, NOW.toISOString())).toEqual([a]);
  });
});

describe("card view-model", () => {
  it("derives the script state the production gate will see", () => {
    expect(scriptState({ storyId: null, scriptId: null, scriptDecision: null })).toBe("no_story");
    expect(scriptState({ storyId: "s", scriptId: null, scriptDecision: null })).toBe("missing");
    expect(scriptState({ storyId: "s", scriptId: "v1", scriptDecision: null })).toBe("pending");
    expect(scriptState({ storyId: "s", scriptId: "v1", scriptDecision: "rejected" })).toBe("rejected");
    expect(scriptState({ storyId: "s", scriptId: "v1", scriptDecision: "approved" })).toBe("approved");
  });

  it("shows blockers only for review/production/ready cards whose blockers are known", () => {
    const blockers = ["2 critical fact(s) not confirmed"];
    expect(cardView(item({ stage: "review", blockers }), NOW)).toMatchObject({ blockerCount: 1, blockers });
    expect(cardView(item({ stage: "ready", blockers: [] }), NOW).blockerCount).toBe(0);
    expect(cardView(item({ stage: "idea", blockers }), NOW).blockerCount).toBeNull();
    expect(cardView(item({ stage: "production", blockers: null }), NOW).blockerCount).toBeNull();
  });

  it("builds the card: link, format label, opportunity score, script label, gate warning, stage age", () => {
    const v = cardView(
      item({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Bologna stun Inter",
        format: "long",
        stage: "review",
        storyId: "s",
        scriptId: "v2",
        opportunityId: "o",
        opportunityTitle: "Upset at San Siro",
        opportunityScore: 81.5,
        stageChangedAt: hoursAgo(3),
      }),
      NOW,
    );
    expect(v).toMatchObject({
      href: "/content/11111111-1111-4111-8111-111111111111",
      formatLabel: "Long-form",
      opportunityScore: 81.5,
      opportunityTitle: "Upset at San Siro",
      script: "pending",
      scriptLabel: "Script pending",
      productionGateClosed: true,
      pending: false,
    });
    expect(v.age).toEqual({ label: "3h", days: 0, stalled: false });
    expect(cardView(item({ stage: "production", storyId: "s", scriptId: "v", scriptDecision: "approved" }), NOW).productionGateClosed).toBe(false);
  });

  it("labels stage age and flags stalled work (not for published/analyzing)", () => {
    expect(stageAge("idea", NOW.toISOString(), NOW).label).toBe("now");
    expect(stageAge("idea", hoursAgo(0.5), NOW).label).toBe("30m");
    expect(stageAge("script", hoursAgo(24 * 8), NOW)).toEqual({ label: "8d", days: 8, stalled: true });
    expect(stageAge("published", hoursAgo(24 * 30), NOW).stalled).toBe(false);
    // clock skew: a future timestamp is "now", never negative
    expect(stageAge("idea", hoursAgo(-1), NOW).label).toBe("now");
  });

  it("describes the DB gate on entry for the gated columns only", () => {
    expect(stageGate("review")).toBeNull();
    expect(stageGate("production")).toMatch(/script approved/);
    expect(stageGate("ready")).toMatch(/confirmed critical claims/);
    expect(stageGate("analyzing")).toMatch(/script/);
  });
});

describe("gates and blockers explained", () => {
  it("explains the READY gate's own blocker strings with a next step", () => {
    const facts = explainBlocker("2 critical fact(s) not confirmed", { opportunityId: "opp-1" });
    expect(facts).toMatchObject({ kind: "facts", count: 2, title: "2 critical claims not confirmed" });
    expect(facts.action).toEqual({ label: "Open claims in research", href: "/research/opp-1?tab=claims" });
    expect(facts.explanation).toMatch(/research workspace/);
    const ideaFacts = explainBlocker("1 critical fact(s) not confirmed", { opportunityId: null });
    expect(ideaFacts.action).toBeNull();
    // an item born as an idea has no research workspace: never point there
    expect(ideaFacts.explanation).toMatch(/no research workspace/);

    const clips = explainBlocker(
      "1 clip(s) use material not cleared for production (RED, unchecked or unapproved YELLOW)",
      { opportunityId: null },
    );
    expect(clips).toMatchObject({ kind: "clips", count: 1, title: "1 clip use material not cleared for production" });
    expect(clips.action?.href).toBe("/rights");

    expect(explainBlocker("something new", { opportunityId: null })).toMatchObject({ kind: "other", title: "something new", action: null });
  });

  it("reports both gates", () => {
    const [scriptGate, readyGate] = gateViews({ script: "approved", blockers: [] });
    expect(scriptGate).toMatchObject({ key: "script", state: "open" });
    expect(readyGate).toMatchObject({ key: "ready", state: "open" });
    const closed = gateViews({ script: "pending", blockers: ["1 critical fact(s) not confirmed"] });
    expect(closed.map((g) => g.state)).toEqual(["closed", "closed"]);
    expect(closed[1].detail).toBe("1 blocker listed below.");
    expect(gateViews({ script: "no_story", blockers: [] })[0].detail).toMatch(/create the story/i);
  });

  it("maps refused moves to clear messages", () => {
    expect(moveErrorMessage({ code: "P0001", message: "SCRIPT_NOT_APPROVED: the current script must be approved before production" })).toBe(
      "Approve the current script before moving to production.",
    );
    expect(moveErrorMessage({ code: "P0001", message: "SCRIPT_NOT_APPROVED: link a story with an approved script before production" })).toMatch(
      /Create the story/,
    );
    expect(moveErrorMessage({ code: "P0001", message: "CONTENT_NOT_READY: 1 critical fact(s) not confirmed" }, "ready")).toBe(
      "Can't move to READY: 1 critical fact(s) not confirmed. Resolve the blockers on the item page first.",
    );
    expect(moveErrorMessage({ code: "42501", message: "permission denied" })).toBe("You don't have permission to do this.");
  });
});

describe("content input validation", () => {
  it("validates fields (format enum, trimmed title, empty description → null)", () => {
    expect(contentFieldsSchema.parse({ title: "  Hojlund's numbers  ", format: "post", description: "" })).toEqual({
      title: "Hojlund's numbers",
      format: "post",
      description: null,
    });
    expect(contentFieldsSchema.safeParse({ title: " ", format: "short" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ title: "x", format: "reel" }).success).toBe(false);
  });

  it("validates moves and decisions", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(moveSchema.parse({ id, stage: "review" })).toEqual({ id, stage: "review" });
    expect(moveSchema.safeParse({ id, stage: "archived" }).success).toBe(false);
    expect(moveSchema.safeParse({ id: "nope", stage: "idea" }).success).toBe(false);
    expect(moveSchema.safeParse({ id, stage: "idea", index: -1 }).success).toBe(false);
    expect(storyDecisionSchema.parse({ storyId: id, decision: "approved", notes: "  " })).toEqual({ storyId: id, decision: "approved", notes: null });
    expect(storyDecisionSchema.safeParse({ storyId: id, decision: "maybe" }).success).toBe(false);
  });

  it("parses the item tab", () => {
    expect(parseDetailTab("script")).toBe("script");
    expect(parseDetailTab(["hooks", "script"])).toBe("hooks");
    expect(parseDetailTab("nope")).toBe("overview");
    expect(parseDetailTab(undefined)).toBe("overview");
  });
});
