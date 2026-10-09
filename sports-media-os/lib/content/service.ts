import type { Db, Enums, Tables } from "@/lib/db/client";
import { parseGuardError } from "@/lib/db/errors";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

import { moveErrorMessage } from "./blockers";
import { BLOCKER_STAGES, compareItems, planPosition, type BoardItem } from "./board";
import type { ContentFields, IdeaInput } from "./schema";
import type { ContentStage } from "./stages";

/**
 * Content Kanban + content item — DB logic. Every function takes the DB client
 * first, so the same code runs as the signed-in user (RLS) and in the worker
 * (service role). Every query is ALSO filtered by the project id passed in.
 *
 * The workflow gates live in the database (SCRIPT_NOT_APPROVED, CONTENT_NOT_READY);
 * this module never re-implements them: it moves, and maps what the DB refuses.
 */

export type ServiceError = { code?: string; message?: string; details?: string | null; userMessage?: string };
export type ServiceResult<T> = { data: T; error: null } | { data: null; error: ServiceError };

const success = <T>(data: T): ServiceResult<T> => ({ data, error: null });
const failure = (error: ServiceError): ServiceResult<never> => ({ data: null, error });
const notFound = (what: string) => failure({ code: "P0001", message: `NOT_FOUND: ${what} not found` });

/** thrown inside a service function, turned into a ServiceResult at its boundary */
class QueryFailed extends Error {
  constructor(readonly error: ServiceError) {
    super(error.message ?? "query failed");
  }
}
function must<T>(res: { data: T; error: ServiceError | null }): T {
  if (res.error) throw new QueryFailed(res.error);
  return res.data;
}
/** for .single() / RPC rows: data is present whenever there is no error */
function mustOne<T>(res: { data: T; error: ServiceError | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new QueryFailed(res.error ?? { message: "no row returned" });
  return res.data as NonNullable<T>;
}
async function guarded<T>(event: string, fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QueryFailed) {
      logger.error(event, { code: e.error.code, message: e.error.message });
      return failure(e.error);
    }
    throw e;
  }
}

/** DB guard refusals (P0001 "CODE: detail") are expected outcomes, not failures to log as errors. */
const isGuard = (error: ServiceError | null | undefined) => Boolean(parseGuardError(error));

/** `.in()` filters travel in the URL: query long id lists in chunks. */
const IN_CHUNK = 100;
async function inChunks<R>(ids: readonly string[], query: (chunk: string[]) => PromiseLike<{ data: R[] | null; error: ServiceError | null }>) {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out.push(...(must(await query(ids.slice(i, i + IN_CHUNK))) ?? []));
  }
  return out;
}

const unique = (ids: readonly (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export type DecisionView = {
  decision: Enums<"approval_decision">;
  notes: string | null;
  createdAt: string;
  decidedBy: string | null;
};

type DecisionRow = Pick<Tables<"approvals">, "decision" | "notes" | "created_at" | "decided_by">;

/** Latest decision per entity for one checkpoint (approvals ordered by seq, the insertion order). */
async function latestDecisions(
  db: Db,
  projectId: string,
  entityType: string,
  checkpoint: Enums<"approval_checkpoint">,
  ids: readonly string[],
): Promise<Map<string, DecisionRow>> {
  const rows = await inChunks(ids, (chunk) =>
    db
      .from("approvals")
      .select("entity_id, decision, notes, created_at, decided_by, seq")
      .eq("project_id", projectId)
      .eq("entity_type", entityType)
      .eq("checkpoint", checkpoint)
      .in("entity_id", chunk)
      .order("seq", { ascending: false }),
  );
  const latest = new Map<string, DecisionRow>();
  for (const r of rows) if (!latest.has(r.entity_id)) latest.set(r.entity_id, r);
  return latest;
}

/** Display names for decision makers (co-members are visible through RLS). */
async function userNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.from("users").select("id, display_name, email").in("id", [...ids]);
  if (error) {
    logger.warn("content.user_names_failed", { code: error.code, message: error.message });
    return new Map();
  }
  return new Map((data ?? []).map((u) => [u.id, u.display_name || u.email]));
}

/* ------------------------------------------------------------------------- */
/* Board                                                                     */
/* ------------------------------------------------------------------------- */

export const BOARD_LIMIT = 1000;

export type BoardData = { items: BoardItem[]; truncated: boolean; generatedAt: string };

/**
 * Every content item of the project with what its card shows: story and
 * opportunity titles, opportunity score, the story's current script and its
 * latest decision, stage age (from stage_changed_at), and — for review,
 * production and ready cards — the READY blockers from rpc content_item_blockers.
 */
export async function board(db: Db, projectId: string): Promise<ServiceResult<BoardData>> {
  return guarded("content.board_failed", async () => {
    const generatedAt = new Date().toISOString();
    const rows =
      must(
        await db
          .from("content_items")
          .select("id, title, format, stage, position, created_at, stage_changed_at, story_id, opportunity_id")
          .eq("project_id", projectId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(BOARD_LIMIT + 1),
      ) ?? [];
    const truncated = rows.length > BOARD_LIMIT;
    const items = rows.slice(0, BOARD_LIMIT);

    const storyIds = unique(items.map((i) => i.story_id));
    const opportunityIds = unique(items.map((i) => i.opportunity_id));
    const [stories, opportunities, scripts] = await Promise.all([
      inChunks(storyIds, (chunk) => db.from("stories").select("id, title, status").in("id", chunk).eq("project_id", projectId)),
      inChunks(opportunityIds, (chunk) =>
        db.from("opportunities").select("id, title, opportunity_score").in("id", chunk).eq("project_id", projectId),
      ),
      inChunks(storyIds, (chunk) =>
        db.from("scripts").select("id, story_id, version").in("story_id", chunk).eq("project_id", projectId).eq("is_current", true),
      ),
    ]);
    const storyById = new Map(stories.map((s) => [s.id, s]));
    const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
    const scriptByStory = new Map(scripts.map((s) => [s.story_id, s]));
    const decisions = await latestDecisions(db, projectId, "script", "script", scripts.map((s) => s.id));

    // READY blockers of every gated card in one round trip per 500 cards
    const needBlockers = items.filter((i) => BLOCKER_STAGES.includes(i.stage as ContentStage));
    const blockersById = new Map<string, string[] | null>(needBlockers.map((i) => [i.id, null]));
    for (let n = 0; n < needBlockers.length; n += 500) {
      const ids = needBlockers.slice(n, n + 500).map((i) => i.id);
      const { data, error } = await db.rpc("content_items_blockers", { p_project_id: projectId, p_ids: ids });
      if (error) {
        // the cards still render; their count shows as unknown
        logger.warn("content.board_blockers_failed", { projectId, code: error.code, message: error.message });
        continue;
      }
      for (const row of data ?? []) blockersById.set(row.content_item_id, row.blockers ?? []);
    }

    const boardItems: BoardItem[] = items.map((i) => {
      const story = i.story_id ? storyById.get(i.story_id) : undefined;
      const opportunity = i.opportunity_id ? opportunityById.get(i.opportunity_id) : undefined;
      const script = i.story_id ? scriptByStory.get(i.story_id) : undefined;
      return {
        id: i.id,
        title: i.title,
        format: i.format,
        stage: i.stage as ContentStage,
        position: i.position,
        createdAt: i.created_at,
        stageChangedAt: i.stage_changed_at,
        storyId: i.story_id,
        storyTitle: story?.title ?? null,
        storyStatus: story?.status ?? null,
        opportunityId: i.opportunity_id,
        opportunityTitle: opportunity?.title ?? null,
        opportunityScore: opportunity?.opportunity_score ?? null,
        scriptId: script?.id ?? null,
        scriptVersion: script?.version ?? null,
        scriptDecision: script ? (decisions.get(script.id)?.decision ?? null) : null,
        blockers: blockersById.get(i.id) ?? null,
      };
    });
    return success({ items: boardItems.sort(compareItems), truncated, generatedAt });
  });
}

/* ------------------------------------------------------------------------- */
/* Create, move, edit                                                        */
/* ------------------------------------------------------------------------- */

/** A new idea lands at the TOP of the IDEA column (it is the freshest thought). */
export async function createIdea(
  db: Db,
  args: { projectId: string; userId: string | null; input: IdeaInput },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("content.create_idea_failed", async () => {
    const { projectId, input } = args;
    const first = must(
      await db
        .from("content_items")
        .select("id, position")
        .eq("project_id", projectId)
        .eq("stage", "idea")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle(),
    );
    const { position } = planPosition(first ? [first] : [], 0);
    const created = mustOne(
      await db
        .from("content_items")
        .insert({
          project_id: projectId,
          title: input.title,
          description: input.description,
          format: input.format,
          stage: "idea",
          position,
          created_by: args.userId,
          metadata: { created_from: "idea" } as { [key: string]: Json },
        })
        .select("id")
        .single(),
    );
    return success({ id: created.id });
  });
}

export type MoveResult = {
  id: string;
  stage: ContentStage;
  from: ContentStage;
  position: number;
  renumbered: number;
  /** false when the card was already there (same stage, no placement asked) */
  changed: boolean;
};

/**
 * Move a card to `stage`. Placement: an explicit `position`, else the drop
 * `index` in the target column (computed from the column as stored now, so a
 * stale client cannot corrupt the order), else the end of the column. A move
 * within the same column only rewrites the position (gates are not re-run);
 * the same stage without a placement (e.g. the stage selector left on the
 * current stage) changes nothing.
 *
 * The DB enforces the gates; a refusal comes back as an error whose
 * `userMessage` explains it (e.g. "Approve the current script before moving
 * to production.").
 */
export async function move(
  db: Db,
  args: { projectId: string; id: string; stage: ContentStage; position?: number; index?: number },
): Promise<ServiceResult<MoveResult>> {
  return guarded<MoveResult>("content.move_failed", async () => {
    const { projectId, id, stage } = args;
    const item = must(await db.from("content_items").select("id, stage, position").eq("id", id).eq("project_id", projectId).maybeSingle());
    if (!item) return notFound("content item");
    const from = item.stage as ContentStage;
    const hasPosition = typeof args.position === "number" && Number.isFinite(args.position);
    if (from === stage && !hasPosition && args.index === undefined) {
      return success({ id, stage, from, position: item.position, renumbered: 0, changed: false });
    }

    let position: number;
    let rebalance: { id: string; position: number }[] = [];
    if (hasPosition) {
      position = args.position!;
    } else {
      const column =
        must(
          await db
            .from("content_items")
            .select("id, position, created_at")
            .eq("project_id", projectId)
            .eq("stage", stage)
            .neq("id", id)
            .order("position", { ascending: true })
            .limit(BOARD_LIMIT),
        ) ?? [];
      const ordered = column.map((c) => ({ id: c.id, position: c.position, createdAt: c.created_at })).sort(compareItems);
      const plan = planPosition(ordered, args.index ?? ordered.length);
      position = plan.position;
      rebalance = plan.rebalance;
    }

    const changes = from === stage ? { position } : { stage, position };
    const { data, error } = await db
      .from("content_items")
      .update(changes)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id, stage, position")
      .maybeSingle();
    if (error) {
      if (!isGuard(error)) throw new QueryFailed(error);
      logger.info("content.move_refused", { projectId, contentItemId: id, from, to: stage, code: parseGuardError(error)?.code });
      return failure({ ...error, userMessage: moveErrorMessage(error, stage) });
    }
    // RLS: a viewer (or another project's member) updates nothing
    if (!data) return notFound("content item");

    for (const r of rebalance) {
      const res = await db.from("content_items").update({ position: r.position }).eq("id", r.id).eq("project_id", projectId);
      // order stays valid (ties fall back to creation time); the next drop renumbers again
      if (res.error) logger.warn("content.rebalance_failed", { projectId, contentItemId: r.id, code: res.error.code, message: res.error.message });
    }
    return success({ id, stage: data.stage as ContentStage, from, position: data.position, renumbered: rebalance.length, changed: true });
  });
}

export async function updateItem(
  db: Db,
  args: { projectId: string; id: string; fields: ContentFields },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("content.update_failed", async () => {
    const { title, description, format } = args.fields;
    const updated = must(
      await db
        .from("content_items")
        .update({ title, description, format })
        .eq("id", args.id)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    return updated ? success({ id: updated.id }) : notFound("content item");
  });
}

/* ------------------------------------------------------------------------- */
/* Story: create + human checkpoint                                          */
/* ------------------------------------------------------------------------- */

/**
 * An item without a story gets one built from its own title/description (and
 * its opportunity's angle/hook when there is one), created and linked in one
 * transaction by public.create_story_for_content_item (row lock: concurrent
 * clicks land on the same story).
 */
export async function createStoryForItem(
  db: Db,
  args: { projectId: string; id: string; userId: string | null },
): Promise<ServiceResult<{ storyId: string; existing: boolean }>> {
  return guarded<{ storyId: string; existing: boolean }>("content.create_story_failed", async () => {
    const { projectId, id } = args;
    const item = must(await db.from("content_items").select("id, story_id").eq("id", id).eq("project_id", projectId).maybeSingle());
    if (!item) return notFound("content item");
    if (item.story_id) return success({ storyId: item.story_id, existing: true });

    const rows = must(await db.rpc("create_story_for_content_item", { p_content_item_id: id }));
    const row = rows?.[0];
    if (!row) throw new QueryFailed({ message: "create_story_for_content_item returned no row" });
    return success({ storyId: row.story_id, existing: row.existing });
  });
}

/**
 * STORY → APPROVAL through public.record_approval('story', …): records the
 * human decision and sets stories.status atomically; refuses automated
 * callers. STORY ≠ FOOTAGE: nothing here looks at footage or rights — a story
 * can be approved when no footage is usable (original formats are planned
 * with the editorial alternatives).
 */
export async function decideStory(
  db: Db,
  args: { projectId: string; storyId: string; decision: Enums<"approval_decision">; notes: string | null },
): Promise<ServiceResult<{ approvalId: string; status: Enums<"approval_decision"> }>> {
  return guarded("content.story_decision_failed", async () => {
    const story = must(await db.from("stories").select("id").eq("id", args.storyId).eq("project_id", args.projectId).maybeSingle());
    if (!story) return notFound("story");
    const approval = mustOne(
      await db.rpc("record_approval", {
        p_checkpoint: "story",
        p_entity_id: args.storyId,
        p_decision: args.decision,
        ...(args.notes ? { p_notes: args.notes } : {}),
      }),
    );
    return success({ approvalId: approval.id, status: args.decision });
  });
}

/* ------------------------------------------------------------------------- */
/* Detail                                                                    */
/* ------------------------------------------------------------------------- */

export type StoryView = Pick<
  Tables<"stories">,
  "id" | "title" | "logline" | "angle" | "status" | "production_formats" | "opportunity_id" | "created_at" | "updated_at"
>;
export type OpportunityView = Pick<
  Tables<"opportunities">,
  "id" | "title" | "status" | "opportunity_score" | "score_coverage" | "why_now" | "competition"
>;
export type CurrentScriptView = {
  id: string;
  version: number;
  angle: Enums<"script_angle"> | null;
  wordCount: number | null;
  createdAt: string;
  decision: DecisionView | null;
};
export type BlockingFact = {
  id: string;
  claim: string;
  status: Enums<"fact_status">;
  /** what the claim is attached to (the READY gate checks all three) */
  scope: "item" | "story" | "opportunity";
};
export type BlockingClip = {
  id: string;
  title: string | null;
  status: Enums<"clip_status">;
  videoId: string;
  videoTitle: string | null;
  rightsStatus: Enums<"rights_status"> | null;
};
export type ApprovalEntry = {
  id: string;
  checkpoint: Enums<"approval_checkpoint">;
  entityType: string;
  entityLabel: string;
  decision: Enums<"approval_decision">;
  notes: string | null;
  createdAt: string;
  decidedBy: string | null;
};

export type ContentItemDetail = {
  item: Tables<"content_items">;
  story: StoryView | null;
  storyDecision: DecisionView | null;
  opportunity: OpportunityView | null;
  currentScript: CurrentScriptView | null;
  scriptCount: number;
  /** rpc content_item_blockers — the READY gate's own list */
  blockers: string[];
  blockingFacts: BlockingFact[];
  blockingClips: BlockingClip[];
  approvals: ApprovalEntry[];
};

const HISTORY_LIMIT = 50;
const DETAIL_LIST_LIMIT = 25;

/**
 * Everything the item page shows: the item, its story (+ latest decision), its
 * opportunity, the story's current script (+ latest decision), the READY
 * blockers (rpc content_item_blockers) with the claims/clips behind them, and
 * the approvals history of the item, story, scripts and opportunity.
 */
export async function detail(db: Db, projectId: string, id: string): Promise<ServiceResult<ContentItemDetail>> {
  return guarded("content.detail_failed", async () => {
    const item = must(await db.from("content_items").select("*").eq("id", id).eq("project_id", projectId).maybeSingle());
    if (!item) return notFound("content item");

    const [story, opportunity, blockers, scripts] = await Promise.all([
      item.story_id
        ? db
            .from("stories")
            .select("id, title, logline, angle, status, production_formats, opportunity_id, created_at, updated_at")
            .eq("id", item.story_id)
            .eq("project_id", projectId)
            .maybeSingle()
            .then(must)
        : null,
      item.opportunity_id
        ? db
            .from("opportunities")
            .select("id, title, status, opportunity_score, score_coverage, why_now, competition")
            .eq("id", item.opportunity_id)
            .eq("project_id", projectId)
            .maybeSingle()
            .then(must)
        : null,
      db.rpc("content_item_blockers", { p_content_item_id: id }).then(must),
      item.story_id
        ? db
            .from("scripts")
            .select("id, version, angle, word_count, created_at, is_current")
            .eq("story_id", item.story_id)
            .eq("project_id", projectId)
            .order("version", { ascending: false })
            .then(must)
        : [],
    ]);
    const scriptRows = scripts ?? [];
    const current = scriptRows.find((s) => s.is_current) ?? null;
    const blockerList = blockers ?? [];

    const [storyDecisions, scriptDecisions, history, facts, clips] = await Promise.all([
      story ? latestDecisions(db, projectId, "story", "story", [story.id]) : new Map<string, DecisionRow>(),
      current ? latestDecisions(db, projectId, "script", "script", [current.id]) : new Map<string, DecisionRow>(),
      inChunks(unique([item.id, story?.id, opportunity?.id, ...scriptRows.map((s) => s.id)]), (chunk) =>
        db
          .from("approvals")
          .select("id, seq, checkpoint, entity_type, entity_id, decision, notes, created_at, decided_by")
          .eq("project_id", projectId)
          .in("entity_type", ["content_item", "story", "script", "opportunity"])
          .in("entity_id", chunk)
          .order("seq", { ascending: false })
          .limit(HISTORY_LIMIT),
      ),
      blockerList.length ? loadBlockingFacts(db, projectId, item) : [],
      blockerList.length ? loadBlockingClips(db, projectId, item.id) : [],
    ]);
    const approvals = history.sort((a, b) => b.seq - a.seq).slice(0, HISTORY_LIMIT);
    const storyDecision = story ? storyDecisions.get(story.id) : undefined;
    const scriptDecision = current ? scriptDecisions.get(current.id) : undefined;

    const names = await userNames(
      db,
      unique([...approvals.map((a) => a.decided_by), storyDecision?.decided_by, scriptDecision?.decided_by]),
    );
    const toView = (d: DecisionRow | undefined): DecisionView | null =>
      d ? { decision: d.decision, notes: d.notes, createdAt: d.created_at, decidedBy: names.get(d.decided_by) ?? null } : null;
    const versionById = new Map(scriptRows.map((s) => [s.id, s.version]));
    const label = (entityType: string, entityId: string) => {
      if (entityType === "script") {
        const v = versionById.get(entityId);
        return v ? `Script v${v}` : "Script";
      }
      if (entityType === "story") return "Story";
      if (entityType === "opportunity") return "Opportunity";
      return "Content item";
    };

    return success({
      item,
      story,
      storyDecision: toView(storyDecision),
      opportunity,
      currentScript: current
        ? {
            id: current.id,
            version: current.version,
            angle: current.angle,
            wordCount: current.word_count,
            createdAt: current.created_at,
            decision: toView(scriptDecision),
          }
        : null,
      scriptCount: scriptRows.length,
      blockers: blockerList,
      blockingFacts: facts,
      blockingClips: clips,
      approvals: approvals.map((a) => ({
        id: a.id,
        checkpoint: a.checkpoint,
        entityType: a.entity_type,
        entityLabel: label(a.entity_type, a.entity_id),
        decision: a.decision,
        notes: a.notes,
        createdAt: a.created_at,
        decidedBy: names.get(a.decided_by) ?? null,
      })),
    });
  });
}

/** Unconfirmed critical claims in the READY gate's scope (item, its story, its opportunity). */
async function loadBlockingFacts(
  db: Db,
  projectId: string,
  item: Pick<Tables<"content_items">, "id" | "story_id" | "opportunity_id">,
): Promise<BlockingFact[]> {
  // ids come from the DB row (uuids), safe inside the or() filter
  const scope = [`content_item_id.eq.${item.id}`];
  if (item.story_id) scope.push(`story_id.eq.${item.story_id}`);
  if (item.opportunity_id) scope.push(`opportunity_id.eq.${item.opportunity_id}`);
  const rows =
    must(
      await db
        .from("facts")
        .select("id, claim, status, content_item_id, story_id, opportunity_id")
        .eq("project_id", projectId)
        .eq("is_critical", true)
        .neq("status", "confirmed")
        .or(scope.join(","))
        .order("created_at", { ascending: true })
        .limit(DETAIL_LIST_LIMIT),
    ) ?? [];
  return rows.map((f) => ({
    id: f.id,
    claim: f.claim,
    status: f.status,
    scope: f.content_item_id === item.id ? "item" : item.story_id && f.story_id === item.story_id ? "story" : "opportunity",
  }));
}

/** Clips of the item cut from material not cleared for production. */
async function loadBlockingClips(db: Db, projectId: string, itemId: string): Promise<BlockingClip[]> {
  const clips =
    must(
      await db
        .from("clips")
        .select("id, title, status, video_id")
        .eq("project_id", projectId)
        .eq("content_item_id", itemId)
        .neq("status", "rejected")
        .order("created_at", { ascending: true })
        .limit(200),
    ) ?? [];
  const videoIds = unique(clips.map((c) => c.video_id));
  const videos = await inChunks(videoIds, (chunk) =>
    db.from("videos").select("id, title, rights_status, usable_in_production").in("id", chunk).eq("project_id", projectId),
  );
  const byId = new Map(videos.map((v) => [v.id, v]));
  return clips
    .filter((c) => !byId.get(c.video_id)?.usable_in_production)
    .slice(0, DETAIL_LIST_LIMIT)
    .map((c) => {
      const v = byId.get(c.video_id);
      return { id: c.id, title: c.title, status: c.status, videoId: c.video_id, videoTitle: v?.title ?? null, rightsStatus: v?.rights_status ?? null };
    });
}
