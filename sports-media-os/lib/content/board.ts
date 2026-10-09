import type { Enums } from "@/lib/db/client";

import type { ContentFormat } from "./schema";
import { FORMAT_LABELS } from "./schema";
import { CONTENT_STAGE_ORDER, STAGE_LABELS, type ContentStage } from "./stages";

/**
 * Content Kanban — pure logic (no DB, no React): grouping in Kanban order,
 * ordering inside a column, the position a dropped card gets between its new
 * neighbours, the optimistic move and the card view-model. Shared by the
 * service (server) and the board (client), so both compute the same order.
 */

/** One card as the service loads it (story, opportunity and script state attached). */
export type BoardItem = {
  id: string;
  title: string;
  format: ContentFormat;
  stage: ContentStage;
  position: number;
  createdAt: string;
  stageChangedAt: string;
  storyId: string | null;
  storyTitle: string | null;
  storyStatus: Enums<"story_status"> | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  opportunityScore: number | null;
  /** the story's CURRENT script (the one the production gate checks) */
  scriptId: string | null;
  scriptVersion: number | null;
  /** latest human decision on the current script (approvals ordered by seq) */
  scriptDecision: Enums<"approval_decision"> | null;
  /** READY blockers (rpc content_item_blockers); null = not computed for this stage */
  blockers: string[] | null;
  /** optimistic UI only: a move for this card is in flight */
  pending?: boolean;
};

/** Stages whose cards show their READY blockers count. */
export const BLOCKER_STAGES: readonly ContentStage[] = ["review", "production", "ready"];

/** DB gate: PRODUCTION and later need the story's current script approved (SCRIPT_NOT_APPROVED). */
export const SCRIPT_GATE_STAGES: readonly ContentStage[] = ["production", "ready", "scheduled", "published", "analyzing"];

/** DB gate: READY/SCHEDULED/PUBLISHED need no blockers (CONTENT_NOT_READY). */
export const READY_GATE_STAGES: readonly ContentStage[] = ["ready", "scheduled", "published"];

/** Stages where time in stage is not a work-in-progress signal. */
const RESTING_STAGES: readonly ContentStage[] = ["published", "analyzing"];

/** Days in an active stage after which a card is flagged as stalled. */
export const STALLED_AFTER_DAYS = 7;

export const POSITION_STEP = 1024;
/** below this gap two neighbours are "touching": the column is renumbered */
const MIN_GAP = 1e-6;
/** keep positions in a range where midpoints stay exact enough */
const MAX_ABS_POSITION = 1e12;

/* ------------------------------------------------------------------------- */
/* Order + grouping                                                          */
/* ------------------------------------------------------------------------- */

type Orderable = { id: string; position: number; createdAt: string };

/** Column order: position, then creation time, then id (stable when positions tie). */
export function compareItems(a: Orderable, b: Orderable): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type BoardColumn<T> = { stage: ContentStage; label: string; items: T[] };

/** Every Kanban column in order (empty ones included), each sorted. Unknown stages are dropped. */
export function groupByStage<T extends Orderable & { stage: string }>(items: readonly T[]): BoardColumn<T>[] {
  const byStage = new Map<string, T[]>(CONTENT_STAGE_ORDER.map((s) => [s, []]));
  for (const item of items) byStage.get(item.stage)?.push(item);
  return CONTENT_STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    items: [...(byStage.get(stage) ?? [])].sort(compareItems),
  }));
}

export function countByStage(items: readonly { stage: string }[]): Record<ContentStage, number> {
  const counts = Object.fromEntries(CONTENT_STAGE_ORDER.map((s) => [s, 0])) as Record<ContentStage, number>;
  for (const item of items) if (item.stage in counts) counts[item.stage as ContentStage] += 1;
  return counts;
}

/* ------------------------------------------------------------------------- */
/* Positions                                                                 */
/* ------------------------------------------------------------------------- */

export type PositionPlan = {
  /** position for the moved card */
  position: number;
  /** other cards of the column that must be renumbered (only when there was no room) */
  rebalance: { id: string; position: number }[];
};

const usable = (n: number) => Number.isFinite(n) && Math.abs(n) < MAX_ABS_POSITION;

/**
 * Position for a card dropped at `index` of a column. `column` holds the
 * target column's other cards in display order (the moved card excluded).
 * Between two neighbours → their midpoint; at an end → one step beyond it;
 * empty column → one step. When neighbours tie (or the gap is exhausted) the
 * whole column is renumbered in steps and the plan lists the cards to update.
 */
export function planPosition(column: readonly { id: string; position: number }[], index: number): PositionPlan {
  const at = Math.max(0, Math.min(Math.trunc(Number.isFinite(index) ? index : column.length), column.length));
  const before = at > 0 ? column[at - 1].position : null;
  const after = at < column.length ? column[at].position : null;

  let position: number | null = null;
  if (before === null && after === null) position = POSITION_STEP;
  else if (before === null) position = after! - POSITION_STEP;
  else if (after === null) position = before + POSITION_STEP;
  else if (after - before > MIN_GAP * 2) position = before + (after - before) / 2;

  if (position !== null && usable(position) && (before === null || usable(before)) && (after === null || usable(after))) {
    return { position, rebalance: [] };
  }

  // no room (ties, exhausted gap or runaway values): renumber the column
  const rebalance: { id: string; position: number }[] = [];
  let moved = POSITION_STEP;
  for (let i = 0, slot = 1; i <= column.length; i++, slot++) {
    if (i === at) {
      moved = slot * POSITION_STEP;
      slot++;
    }
    if (i === column.length) break;
    const next = slot * POSITION_STEP;
    if (column[i].position !== next) rebalance.push({ id: column[i].id, position: next });
  }
  return { position: moved, rebalance };
}

export type MoveRequest = { id: string; stage: ContentStage; index?: number };

/**
 * Optimistic move: the card goes to `stage` at `index` (end of the column when
 * missing), renumbering the column when needed. Changing stage resets the stage
 * age and the blockers (unknown until the server answers). Unknown id → unchanged.
 */
export function applyMove<T extends BoardItem>(items: readonly T[], move: MoveRequest, nowIso: string): T[] {
  const moving = items.find((i) => i.id === move.id);
  if (!moving) return [...items];
  const column = items.filter((i) => i.stage === move.stage && i.id !== move.id).sort(compareItems);
  const plan = planPosition(column, move.index ?? column.length);
  const renumbered = new Map(plan.rebalance.map((r) => [r.id, r.position]));
  const stageChanged = moving.stage !== move.stage;

  return items.map((item) => {
    if (item.id === move.id) {
      return {
        ...item,
        stage: move.stage,
        position: plan.position,
        pending: true,
        ...(stageChanged ? { stageChangedAt: nowIso, blockers: null } : {}),
      };
    }
    const position = renumbered.get(item.id);
    return position === undefined ? item : { ...item, position };
  });
}

/* ------------------------------------------------------------------------- */
/* Card view-model                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Script state of a card (what the production gate will say):
 * approved / rejected / pending (current script awaiting a decision) /
 * missing (story without a current script) / no_story.
 */
export type ScriptState = "approved" | "rejected" | "pending" | "missing" | "no_story";

export function scriptState(item: Pick<BoardItem, "storyId" | "scriptId" | "scriptDecision">): ScriptState {
  if (!item.storyId) return "no_story";
  if (!item.scriptId) return "missing";
  if (item.scriptDecision === "approved") return "approved";
  if (item.scriptDecision === "rejected") return "rejected";
  return "pending";
}

export const SCRIPT_STATE_LABELS: Record<ScriptState, string> = {
  approved: "Script approved",
  rejected: "Script rejected",
  pending: "Script pending",
  missing: "No script yet",
  no_story: "No story",
};

export type StageAge = { label: string; days: number; stalled: boolean };

/** "now", "45m", "6h", "3d" in the current stage; stalled after STALLED_AFTER_DAYS in an active stage. */
export function stageAge(stage: ContentStage, stageChangedAt: string, now: Date): StageAge {
  const ms = now.getTime() - new Date(stageChangedAt).getTime();
  const sec = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const days = Math.floor(sec / 86_400);
  const label = sec < 60 ? "now" : sec < 3600 ? `${Math.floor(sec / 60)}m` : sec < 86_400 ? `${Math.floor(sec / 3600)}h` : `${days}d`;
  return { label, days, stalled: days >= STALLED_AFTER_DAYS && !RESTING_STAGES.includes(stage) };
}

export type CardView = {
  id: string;
  href: string;
  title: string;
  stage: ContentStage;
  format: ContentFormat;
  formatLabel: string;
  opportunityTitle: string | null;
  opportunityScore: number | null;
  storyTitle: string | null;
  age: StageAge;
  script: ScriptState;
  scriptLabel: string;
  /** blockers count, only for review/production/ready cards whose blockers are known */
  blockerCount: number | null;
  blockers: string[];
  /** the next production move will be refused by the DB (script not approved) */
  productionGateClosed: boolean;
  pending: boolean;
};

export function cardView(item: BoardItem, now: Date): CardView {
  const script = scriptState(item);
  const showBlockers = BLOCKER_STAGES.includes(item.stage) && item.blockers !== null;
  return {
    id: item.id,
    href: `/content/${item.id}`,
    title: item.title,
    stage: item.stage,
    format: item.format,
    formatLabel: FORMAT_LABELS[item.format] ?? item.format,
    opportunityTitle: item.opportunityTitle,
    opportunityScore: item.opportunityScore,
    storyTitle: item.storyTitle,
    age: stageAge(item.stage, item.stageChangedAt, now),
    script,
    scriptLabel: SCRIPT_STATE_LABELS[script],
    blockerCount: showBlockers ? item.blockers!.length : null,
    blockers: showBlockers ? item.blockers! : [],
    productionGateClosed: script !== "approved" && !SCRIPT_GATE_STAGES.includes(item.stage),
    pending: Boolean(item.pending),
  };
}

/** Short gate description for a column header (null = no DB gate on entry). */
export function stageGate(stage: ContentStage): string | null {
  if (READY_GATE_STAGES.includes(stage)) return "Needs an approved current script, confirmed critical claims and cleared clip material";
  if (SCRIPT_GATE_STAGES.includes(stage)) return "Needs the story's current script approved";
  return null;
}
