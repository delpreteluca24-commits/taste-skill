import type { Db, Enums, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import type { EditorialFormat } from "@/lib/rights/alternatives";
import { readItemMeta } from "@/lib/research/schema";
import type { Json, TablesInsert } from "@/types/database";
import { limitContext, type PromptFact, type StoryPromptContext } from "@/prompts/script/context";

import { buildDraft, type DraftVersion } from "./generate";
import { parseWarning, type ScriptWarning } from "./grounding";
import { readHookExplanation, scoreManualHook, type GeneratedHook, type HookExplanation } from "./hooks";
import {
  SCRIPT_ANGLES,
  SCRIPT_SECTIONS,
  type HookType,
  type ManualHookInput,
  type ManualVersionInput,
  type ScriptAngle,
  type ScriptOperation,
  type ScriptSections,
} from "./schema";

/**
 * Script Studio & Hook Studio — DB logic. Every function takes the DB client
 * first, so the same code runs as the signed-in user (RLS) and in the worker
 * (service role). Every query is ALSO filtered by the project id passed in.
 *
 * DB rules this code relies on (never re-implemented here):
 * - script versions are immutable (SCRIPT_IMMUTABLE); the version number is
 *   assigned by the insert trigger; one is_current per story — switching the
 *   current version is an update of is_current only
 * - SCRIPT → APPROVAL goes through public.record_approval('script', …), which
 *   refuses callers without a signed-in person (agents never approve)
 * - content cannot reach production unless the CURRENT script's latest
 *   decision is 'approved' (SCRIPT_NOT_APPROVED)
 * - one selected hook per story (trigger)
 */

export type ServiceError = { code?: string; message?: string; details?: string | null; userMessage?: string };
export type ServiceResult<T> = { data: T; error: null } | { data: null; error: ServiceError };

const success = <T>(data: T): ServiceResult<T> => ({ data, error: null });
const failure = (error: ServiceError): ServiceResult<never> => ({ data: null, error });
const notFound = (what: string) => failure({ code: "P0001", message: `NOT_FOUND: ${what} not found` });
const invalid = (userMessage: string) => failure({ code: "22023", message: userMessage, userMessage });

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
function mustOne<T>(res: { data: T; error: ServiceError | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new QueryFailed(res.error ?? { message: "no row returned" });
  return res.data as NonNullable<T>;
}
async function guarded<T>(event: string, fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QueryFailed) {
      // business-rule refusals (guards, FK/unique, RLS) are expected outcomes, not server errors
      const expected = ["P0001", "22023", "23503", "23505", "42501"].includes(e.error.code ?? "");
      logger[expected ? "warn" : "error"](event, { code: e.error.code, message: e.error.message });
      return failure(e.error);
    }
    throw e;
  }
}

/** `.in()` lists go in the URL: query long id lists in chunks */
const CHUNK = 100;
async function inChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: ServiceError | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await run(ids.slice(i, i + CHUNK));
    if (res.error) throw new QueryFailed(res.error);
    out.push(...(res.data ?? []));
  }
  return out;
}

const uniq = <T>(values: Iterable<T | null | undefined>): T[] => [...new Set([...values].filter((v): v is T => v !== null && v !== undefined))];

/** Display names of co-members (RLS: failures just hide names). */
async function loadPeople(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("users").select("id, display_name, email").in("id", ids);
  if (error) {
    logger.warn("scripts.load_people_failed", { code: error.code });
    return new Map();
  }
  return new Map((data ?? []).map((u) => [u.id, u.display_name || u.email]));
}

/* ------------------------------------------------------------------------- */
/* story + prompt material                                                   */
/* ------------------------------------------------------------------------- */

export type StoryRef = {
  id: string;
  title: string;
  logline: string | null;
  angle: string | null;
  status: Enums<"story_status">;
  opportunityId: string | null;
  productionFormats: EditorialFormat[];
};

export type StoryFact = { id: string; claim: string; status: Enums<"fact_status">; isCritical: boolean };

export type StoryMaterial = {
  story: StoryRef;
  /** what the model sees and what grounding checks against */
  context: StoryPromptContext;
  /** every claim of the story, refuted ones included (for chips and counts) */
  allFacts: StoryFact[];
};

async function loadStoryRow(db: Db, projectId: string, storyId: string): Promise<StoryRef | null> {
  const row = must(
    await db
      .from("stories")
      .select("id, title, logline, angle, status, opportunity_id, production_formats")
      .eq("id", storyId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    logline: row.logline,
    angle: row.angle,
    status: row.status,
    opportunityId: row.opportunity_id,
    productionFormats: (row.production_formats ?? []) as EditorialFormat[],
  };
}

/** The project's story, or NOT_FOUND — checked by actions before enqueueing AI work. */
export async function getStoryRef(db: Db, projectId: string, storyId: string): Promise<ServiceResult<StoryRef>> {
  return guarded("scripts.get_story_failed", async () => {
    const story = await loadStoryRow(db, projectId, storyId);
    return story ? success(story) : notFound("story");
  });
}

/**
 * Everything a script or hook may be written from: the story, its
 * opportunity, its research claims (story, opportunity and content-item level),
 * the claims' sources, the research quotes and the production formats.
 * `limit` (default) applies the prompt limits — use the SAME result for the
 * prompt and for grounding.
 */
export async function loadStoryMaterial(
  db: Db,
  projectId: string,
  storyId: string,
  opts: { limit?: boolean } = {},
): Promise<ServiceResult<StoryMaterial>> {
  return guarded("scripts.load_material_failed", async () => {
    const story = await loadStoryRow(db, projectId, storyId);
    if (!story) return notFound("story");
    const oppId = story.opportunityId;

    const [project, opportunity, items] = await Promise.all([
      db.from("projects").select("language").eq("id", projectId).maybeSingle(),
      oppId
        ? db
            .from("opportunities")
            .select("title, description, why_now, angle, hook, competition")
            .eq("id", oppId)
            .eq("project_id", projectId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("content_items").select("id").eq("story_id", story.id).eq("project_id", projectId),
    ]);
    const itemIds = (must(items) ?? []).map((i) => i.id);

    // claims at story, opportunity or content-item level (ids are validated uuids)
    const scopes = [`story_id.eq.${story.id}`];
    if (oppId) scopes.push(`opportunity_id.eq.${oppId}`);
    if (itemIds.length) scopes.push(`content_item_id.in.(${itemIds.slice(0, 50).join(",")})`);
    const [factsRes, quotesRes, itemSourcesRes] = await Promise.all([
      db
        .from("facts")
        .select("id, claim, status, is_critical, created_at")
        .eq("project_id", projectId)
        .or(scopes.join(","))
        .order("created_at"),
      oppId
        ? db
            .from("research_items")
            .select("id, content, source_id, metadata, position")
            .eq("project_id", projectId)
            .eq("opportunity_id", oppId)
            .eq("item_type", "quote")
            .order("position")
        : Promise.resolve({ data: [], error: null }),
      oppId
        ? db
            .from("research_items")
            .select("source_id")
            .eq("project_id", projectId)
            .eq("opportunity_id", oppId)
            .neq("item_type", "competitor")
            .not("source_id", "is", null)
            .order("position")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const factRows = must(factsRes) ?? [];
    const quoteRows = (must(quotesRes) ?? []).filter((q) => q.content && q.content.trim());
    const usable = factRows.filter((f) => f.status !== "false");

    const links = await inChunks(
      usable.map((f) => f.id),
      (chunk) =>
        db
          .from("fact_sources")
          .select("fact_id, source_id, relation")
          .in("fact_id", chunk)
          .eq("project_id", projectId)
          .neq("relation", "contradicts"),
    );
    const sourceIds = uniq([
      ...links.map((l) => l.source_id),
      ...quoteRows.map((q) => q.source_id),
      ...(must(itemSourcesRes) ?? []).map((r) => r.source_id),
    ]);
    const sources = await inChunks(sourceIds, (chunk) =>
      db.from("sources").select("id, title, name").in("id", chunk).eq("project_id", projectId),
    );
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    const o = must(opportunity);
    const context: StoryPromptContext = {
      story: { title: story.title, logline: story.logline, angle: story.angle },
      opportunity: o
        ? { title: o.title, description: o.description, whyNow: o.why_now, angle: o.angle, hook: o.hook, competition: o.competition }
        : null,
      facts: usable.map(
        (f): PromptFact => ({
          id: f.id,
          claim: f.claim,
          status: f.status as PromptFact["status"],
          isCritical: f.is_critical,
          sourceIds: uniq(links.filter((l) => l.fact_id === f.id).map((l) => l.source_id)).filter((id) => sourceById.has(id)),
        }),
      ),
      sources: sourceIds.flatMap((id) => {
        const s = sourceById.get(id);
        return s ? [{ id: s.id, title: s.title ?? s.name, publisher: s.name }] : [];
      }),
      quotes: quoteRows.map((q) => ({
        id: q.id,
        speaker: readItemMeta(q.metadata).speaker,
        text: q.content!.trim(),
        sourceId: q.source_id && sourceById.has(q.source_id) ? q.source_id : null,
      })),
      productionFormats: story.productionFormats,
      language: must(project)?.language ?? null,
    };

    return success({
      story,
      context: opts.limit === false ? context : limitContext(context),
      allFacts: factRows.map((f) => ({ id: f.id, claim: f.claim, status: f.status, isCritical: f.is_critical })),
    });
  });
}

/* ------------------------------------------------------------------------- */
/* versions (read)                                                           */
/* ------------------------------------------------------------------------- */

const SCRIPT_COLUMNS =
  "id, story_id, version, parent_script_id, operation, angle, hook, context, escalation, reveal, payoff, cta, full_text, tone, target_duration_sec, word_count, is_current, provider, model, created_by, created_at, facts_used, warnings, language";

type ScriptRow = Pick<
  Tables<"scripts">,
  | "id"
  | "story_id"
  | "version"
  | "parent_script_id"
  | "operation"
  | "angle"
  | "hook"
  | "context"
  | "escalation"
  | "reveal"
  | "payoff"
  | "cta"
  | "full_text"
  | "tone"
  | "target_duration_sec"
  | "word_count"
  | "is_current"
  | "provider"
  | "model"
  | "created_by"
  | "created_at"
  | "facts_used"
  | "warnings"
  | "language"
>;

export type DecisionView = {
  decision: Enums<"approval_decision">;
  notes: string | null;
  decidedBy: string | null;
  at: string;
};

export type ScriptVersionView = {
  id: string;
  storyId: string;
  version: number;
  angle: ScriptAngle | null;
  operation: ScriptOperation;
  parentId: string | null;
  /** version number of the parent within this story (null when gone or none) */
  parentVersion: number | null;
  isCurrent: boolean;
  sections: ScriptSections;
  fullText: string;
  tone: string | null;
  wordCount: number | null;
  targetDurationSec: number | null;
  provider: string | null;
  model: string | null;
  /** the person who wrote it (manual) or requested it (AI) */
  createdBy: string | null;
  createdAt: string;
  factsUsed: string[];
  warnings: ScriptWarning[];
  language: string | null;
  /** latest SCRIPT decision for this version (approvals.seq order) */
  decision: DecisionView | null;
};

export type AngleGroup = {
  /** null: manual versions written without an angle */
  angle: ScriptAngle | null;
  /** newest first */
  versions: ScriptVersionView[];
};

function sectionsOf(row: ScriptRow): ScriptSections {
  return Object.fromEntries(SCRIPT_SECTIONS.map((s) => [s.key, row[s.key] ?? ""])) as ScriptSections;
}

/** Latest SCRIPT decision per version (ordered by approvals.seq, the insertion order). */
export async function latestScriptDecisions(
  db: Db,
  projectId: string,
  scriptIds: readonly string[],
): Promise<Map<string, Omit<DecisionView, "decidedBy"> & { decidedById: string }>> {
  const rows = await inChunks(scriptIds, (chunk) =>
    db
      .from("approvals")
      .select("entity_id, decision, notes, decided_by, created_at, seq")
      .eq("project_id", projectId)
      .eq("entity_type", "script")
      .eq("checkpoint", "script")
      .in("entity_id", chunk)
      .order("seq", { ascending: false }),
  );
  const out = new Map<string, Omit<DecisionView, "decidedBy"> & { decidedById: string }>();
  for (const r of [...rows].sort((a, b) => b.seq - a.seq)) {
    if (!out.has(r.entity_id)) out.set(r.entity_id, { decision: r.decision, notes: r.notes, decidedById: r.decided_by, at: r.created_at });
  }
  return out;
}

async function loadVersionRows(db: Db, projectId: string, storyId: string): Promise<ScriptRow[]> {
  return (
    must(
      await db
        .from("scripts")
        .select(SCRIPT_COLUMNS)
        .eq("story_id", storyId)
        .eq("project_id", projectId)
        .order("version", { ascending: false }),
    ) ?? []
  );
}

async function toViews(db: Db, projectId: string, rows: ScriptRow[]): Promise<ScriptVersionView[]> {
  const decisions = await latestScriptDecisions(
    db,
    projectId,
    rows.map((r) => r.id),
  );
  const people = await loadPeople(db, uniq([...rows.map((r) => r.created_by), ...[...decisions.values()].map((d) => d.decidedById)]));
  const versionById = new Map(rows.map((r) => [r.id, r.version]));
  return rows.map((r) => {
    const d = decisions.get(r.id);
    const sections = sectionsOf(r);
    return {
      id: r.id,
      storyId: r.story_id,
      version: r.version,
      angle: r.angle,
      operation: r.operation,
      parentId: r.parent_script_id,
      parentVersion: r.parent_script_id ? (versionById.get(r.parent_script_id) ?? null) : null,
      isCurrent: r.is_current,
      sections,
      fullText: r.full_text ?? "",
      tone: r.tone,
      wordCount: r.word_count,
      targetDurationSec: r.target_duration_sec,
      provider: r.provider,
      model: r.model,
      createdBy: r.created_by ? (people.get(r.created_by) ?? null) : null,
      createdAt: r.created_at,
      factsUsed: r.facts_used ?? [],
      warnings: (r.warnings ?? []).map(parseWarning),
      language: r.language,
      decision: d ? { decision: d.decision, notes: d.notes, decidedBy: people.get(d.decidedById) ?? null, at: d.at } : null,
    };
  });
}

/** Group versions by angle (SCRIPT_ANGLES order, manual/no-angle last), newest first. */
export function groupByAngle(versions: readonly ScriptVersionView[]): AngleGroup[] {
  const order: (ScriptAngle | null)[] = [...SCRIPT_ANGLES, null];
  return order
    .map((angle) => ({
      angle,
      versions: versions.filter((v) => v.angle === angle).sort((a, b) => b.version - a.version),
    }))
    .filter((g) => g.versions.length > 0);
}

/** All versions of a story grouped by angle, newest first, with their latest decision. */
export async function listVersions(db: Db, projectId: string, storyId: string): Promise<ServiceResult<AngleGroup[]>> {
  return guarded("scripts.list_versions_failed", async () => {
    const story = await loadStoryRow(db, projectId, storyId);
    if (!story) return notFound("story");
    return success(groupByAngle(await toViews(db, projectId, await loadVersionRows(db, projectId, storyId))));
  });
}

/** The story's current version (or null), with its latest decision. */
export async function getCurrentScript(db: Db, projectId: string, storyId: string): Promise<ServiceResult<ScriptVersionView | null>> {
  return guarded("scripts.get_current_failed", async () => {
    const row = must(
      await db
        .from("scripts")
        .select(SCRIPT_COLUMNS)
        .eq("story_id", storyId)
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle(),
    );
    if (!row) return success(null);
    const [view] = await toViews(db, projectId, [row]);
    return success(view);
  });
}

/** The project's script version (id, story, operation), or NOT_FOUND — checked before enqueueing a transform. */
export async function getScriptRef(
  db: Db,
  projectId: string,
  scriptId: string,
): Promise<ServiceResult<{ id: string; storyId: string; version: number; hasText: boolean }>> {
  return guarded("scripts.get_script_failed", async () => {
    const row = must(
      await db
        .from("scripts")
        .select("id, story_id, version, full_text, hook")
        .eq("id", scriptId)
        .eq("project_id", projectId)
        .maybeSingle(),
    );
    if (!row) return notFound("script");
    return success({ id: row.id, storyId: row.story_id, version: row.version, hasText: Boolean((row.full_text ?? row.hook ?? "").trim()) });
  });
}

/* ------------------------------------------------------------------------- */
/* studio read model                                                         */
/* ------------------------------------------------------------------------- */

export type ActiveJob = { id: string; status: "pending" | "running" };

export type ScriptStudioData = {
  story: StoryRef;
  current: ScriptVersionView | null;
  groups: AngleGroup[];
  versionCount: number;
  /** every claim of the story by id (chips for facts_used) */
  facts: Record<string, StoryFact>;
  factCounts: Record<Enums<"fact_status">, number> & { total: number };
  quotes: number;
  /** open script.generate job for this story */
  generateJob: ActiveJob | null;
  /** open script.transform jobs by parent version id */
  transformJobs: Record<string, ActiveJob & { operation: string }>;
};

/** One read for the whole Script Studio. */
export async function getScriptStudio(db: Db, projectId: string, storyId: string): Promise<ServiceResult<ScriptStudioData>> {
  return guarded("scripts.studio_failed", async () => {
    const material = await loadStoryMaterial(db, projectId, storyId, { limit: false });
    if (material.error) return failure(material.error);
    const { story, allFacts, context } = material.data;

    const versions = await toViews(db, projectId, await loadVersionRows(db, projectId, storyId));
    const ids = versions.map((v) => v.id);
    const [generateJob, transforms] = await Promise.all([
      findActiveJobs(db, projectId, "script.generate", "storyId", [storyId]),
      ids.length ? findActiveJobs(db, projectId, "script.transform", "scriptId", ids) : Promise.resolve([]),
    ]);

    const factCounts = { total: allFacts.length, confirmed: 0, probable: 0, uncertain: 0, false: 0 };
    for (const f of allFacts) factCounts[f.status] += 1;
    const transformJobs: ScriptStudioData["transformJobs"] = {};
    for (const j of transforms) {
      if (!transformJobs[j.entityId]) transformJobs[j.entityId] = { id: j.id, status: j.status, operation: j.operation ?? "" };
    }

    return success({
      story,
      current: versions.find((v) => v.isCurrent) ?? null,
      groups: groupByAngle(versions),
      versionCount: versions.length,
      facts: Object.fromEntries(allFacts.map((f) => [f.id, f])),
      factCounts,
      quotes: context.quotes.length,
      generateJob: generateJob[0] ? { id: generateJob[0].id, status: generateJob[0].status } : null,
      transformJobs,
    });
  });
}

/* ------------------------------------------------------------------------- */
/* versions (write)                                                          */
/* ------------------------------------------------------------------------- */

/**
 * The trigger assigns `version` (max + 1 under a story row lock), so it is
 * left out of the insert on purpose; the generated Insert type still lists it
 * as required, hence the cast.
 */
type NewScript = Omit<TablesInsert<"scripts">, "version">;
const asInsert = (row: NewScript) => row as TablesInsert<"scripts">;

function draftColumns(draft: DraftVersion) {
  return {
    angle: draft.angle,
    ...draft.sections,
    full_text: draft.fullText,
    word_count: draft.wordCount,
    target_duration_sec: draft.targetDurationSec,
    facts_used: draft.factsUsed,
    warnings: draft.warnings,
  };
}

/**
 * MANUAL edit → a NEW version (operation 'manual', parent = current, becomes
 * current). Grounded like AI drafts: warnings say what a reviewer must check.
 */
export async function createManualVersion(
  db: Db,
  args: { projectId: string; userId: string; input: ManualVersionInput },
): Promise<ServiceResult<{ id: string; version: number; warnings: number }>> {
  return guarded("scripts.manual_version_failed", async () => {
    const material = await loadStoryMaterial(db, args.projectId, args.input.storyId, { limit: false });
    if (material.error) return failure(material.error);
    const { context } = material.data;

    const current = must(
      await db
        .from("scripts")
        .select(SCRIPT_COLUMNS)
        .eq("story_id", args.input.storyId)
        .eq("project_id", args.projectId)
        .eq("is_current", true)
        .maybeSingle(),
    );
    const sections: ScriptSections = {
      hook: args.input.hook,
      context: args.input.context,
      escalation: args.input.escalation,
      reveal: args.input.reveal,
      payoff: args.input.payoff,
      cta: args.input.cta,
    };
    const tone = args.input.tone ?? current?.tone ?? null;
    if (current && SCRIPT_SECTIONS.every((s) => (current[s.key] ?? "").trim() === sections[s.key].trim()) && tone === current.tone) {
      return invalid("Nothing changed: edit at least one section to save a new version.");
    }

    const draft = buildDraft(context, {
      angle: current?.angle ?? args.input.angle,
      sections,
      // the edit builds on the current version's cited facts (still in the research)
      factIds: current?.facts_used ?? [],
    });
    const row = mustOne(
      await db
        .from("scripts")
        .insert(
          asInsert({
            project_id: args.projectId,
            story_id: args.input.storyId,
            operation: "manual",
            parent_script_id: current?.id ?? null,
            ...draftColumns(draft),
            tone,
            language: context.language,
            is_current: true,
            created_by: args.userId,
          }),
        )
        .select("id, version")
        .single(),
    );
    return success({ id: row.id, version: row.version, warnings: draft.warnings.length });
  });
}

/** Make a version current: an update of is_current only (the trigger unsets the previous one). */
export async function setCurrentScript(
  db: Db,
  args: { projectId: string; scriptId: string },
): Promise<ServiceResult<{ storyId: string; version: number; changed: boolean }>> {
  return guarded<{ storyId: string; version: number; changed: boolean }>("scripts.set_current_failed", async () => {
    const script = must(
      await db.from("scripts").select("id, story_id, version, is_current").eq("id", args.scriptId).eq("project_id", args.projectId).maybeSingle(),
    );
    if (!script) return notFound("script");
    if (script.is_current) return success({ storyId: script.story_id, version: script.version, changed: false });
    const updated = must(
      await db
        .from("scripts")
        .update({ is_current: true })
        .eq("id", script.id)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return failure({ code: "42501", message: "update refused" });
    return success({ storyId: script.story_id, version: script.version, changed: true });
  });
}

/**
 * SCRIPT → APPROVAL for the CURRENT version through public.record_approval
 * (a signed-in person only; the DB records it and the production gate reads it).
 */
export async function decideScript(
  db: Db,
  args: { projectId: string; scriptId: string; decision: Enums<"approval_decision">; notes: string | null },
): Promise<ServiceResult<{ approvalId: string; storyId: string }>> {
  return guarded("scripts.decision_failed", async () => {
    const script = must(
      await db.from("scripts").select("id, story_id, is_current").eq("id", args.scriptId).eq("project_id", args.projectId).maybeSingle(),
    );
    if (!script) return notFound("script");
    if (!script.is_current) {
      return invalid("Only the current version can be approved or rejected. Make this version current first.");
    }
    const approval = mustOne(
      await db.rpc("record_approval", {
        p_checkpoint: "script",
        p_entity_id: script.id,
        p_decision: args.decision,
        ...(args.notes ? { p_notes: args.notes } : {}),
      }),
    );
    return success({ approvalId: approval.id, storyId: script.story_id });
  });
}

/**
 * Worker: store an AI draft as a new version.
 * makeCurrent 'if_none' → current only when the story has no current version
 * (an AI version never replaces a current — possibly approved — script).
 */
export async function insertScriptVersion(
  db: Db,
  args: {
    projectId: string;
    storyId: string;
    draft: DraftVersion;
    operation: Exclude<ScriptOperation, "manual">;
    parentId: string | null;
    tone: string | null;
    language: string | null;
    provider: string;
    model: string;
    createdBy: string | null;
    makeCurrent: "if_none" | "never";
  },
): Promise<ServiceResult<{ id: string; version: number; isCurrent: boolean }>> {
  return guarded("scripts.insert_version_failed", async () => {
    let isCurrent = false;
    if (args.makeCurrent === "if_none") {
      const existing = must(
        await db.from("scripts").select("id").eq("story_id", args.storyId).eq("project_id", args.projectId).eq("is_current", true).limit(1),
      );
      isCurrent = (existing ?? []).length === 0;
    }
    const row = mustOne(
      await db
        .from("scripts")
        .insert(
          asInsert({
            project_id: args.projectId,
            story_id: args.storyId,
            operation: args.operation,
            parent_script_id: args.parentId,
            ...draftColumns(args.draft),
            tone: args.tone,
            language: args.language,
            provider: args.provider,
            model: args.model,
            is_current: isCurrent,
            created_by: args.createdBy,
          }),
        )
        .select("id, version, is_current")
        .single(),
    );
    return success({ id: row.id, version: row.version, isCurrent: row.is_current });
  });
}

/* ------------------------------------------------------------------------- */
/* hooks                                                                     */
/* ------------------------------------------------------------------------- */

export type HookView = {
  id: string;
  hookType: HookType;
  text: string;
  score: number | null;
  explanation: HookExplanation | null;
  isSelected: boolean;
  angle: ScriptAngle | null;
  provider: string | null;
  model: string | null;
  /** written by the Hook agent (provider set) or by a person */
  origin: "ai" | "manual";
  createdAt: string;
};

export type HookStudioData = {
  story: StoryRef;
  hooks: HookView[];
  /** open hooks.generate job for this story */
  generateJob: ActiveJob | null;
  factCount: number;
};

async function loadHookRows(db: Db, projectId: string, storyId: string) {
  return (
    must(
      await db
        .from("hooks")
        .select("id, hook_type, text, score, score_explanation, is_selected, angle, provider, model, created_at")
        .eq("story_id", storyId)
        .eq("project_id", projectId)
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ) ?? []
  );
}

/** Hooks of a story, best score first. */
export async function listHooks(db: Db, projectId: string, storyId: string): Promise<ServiceResult<HookView[]>> {
  return guarded("scripts.list_hooks_failed", async () => {
    const story = await loadStoryRow(db, projectId, storyId);
    if (!story) return notFound("story");
    const rows = await loadHookRows(db, projectId, storyId);
    return success(
      rows.map((h) => ({
        id: h.id,
        hookType: h.hook_type,
        text: h.text,
        score: h.score,
        explanation: readHookExplanation(h.score_explanation),
        isSelected: h.is_selected,
        angle: h.angle,
        provider: h.provider,
        model: h.model,
        origin: h.provider ? "ai" : "manual",
        createdAt: h.created_at,
      })),
    );
  });
}

export async function getHookStudio(db: Db, projectId: string, storyId: string): Promise<ServiceResult<HookStudioData>> {
  return guarded("scripts.hook_studio_failed", async () => {
    const story = await loadStoryRow(db, projectId, storyId);
    if (!story) return notFound("story");
    const [hooks, jobs, facts] = await Promise.all([
      listHooks(db, projectId, storyId),
      findActiveJobs(db, projectId, "hooks.generate", "storyId", [storyId]),
      loadStoryMaterial(db, projectId, storyId, { limit: false }),
    ]);
    if (hooks.error) return failure(hooks.error);
    if (facts.error) return failure(facts.error);
    return success({
      story,
      hooks: hooks.data,
      generateJob: jobs[0] ? { id: jobs[0].id, status: jobs[0].status } : null,
      factCount: facts.data.context.facts.length,
    });
  });
}

/** Texts of the story's hooks (the Hook agent must not repeat them). */
export async function listHookTexts(db: Db, projectId: string, storyId: string): Promise<ServiceResult<string[]>> {
  return guarded("scripts.list_hook_texts_failed", async () => {
    const rows = must(await db.from("hooks").select("text").eq("story_id", storyId).eq("project_id", projectId)) ?? [];
    return success(rows.map((r) => r.text));
  });
}

/** Select (or clear) a hook; the trigger keeps ONE selected hook per story. */
export async function selectHook(
  db: Db,
  args: { projectId: string; hookId: string; selected: boolean },
): Promise<ServiceResult<{ storyId: string | null }>> {
  return guarded("scripts.select_hook_failed", async () => {
    const updated = must(
      await db
        .from("hooks")
        .update({ is_selected: args.selected })
        .eq("id", args.hookId)
        .eq("project_id", args.projectId)
        .select("id, story_id")
        .maybeSingle(),
    );
    if (!updated) return notFound("hook");
    return success({ storyId: updated.story_id });
  });
}

/** A person's hook, scored with the transparent heuristic only. */
export async function addManualHook(
  db: Db,
  args: { projectId: string; input: ManualHookInput },
): Promise<ServiceResult<{ id: string; score: number }>> {
  return guarded("scripts.add_hook_failed", async () => {
    const material = await loadStoryMaterial(db, args.projectId, args.input.storyId, { limit: false });
    if (material.error) return failure(material.error);
    const { story, context } = material.data;
    const scored = scoreManualHook(args.input.text, context);
    const row = mustOne(
      await db
        .from("hooks")
        .insert({
          project_id: args.projectId,
          story_id: story.id,
          opportunity_id: story.opportunityId,
          hook_type: args.input.hookType,
          text: args.input.text,
          score: scored.score,
          score_explanation: scored.explanation as unknown as Json,
        })
        .select("id")
        .single(),
    );
    return success({ id: row.id, score: scored.score });
  });
}

/** Worker: store the Hook agent's scored hooks. */
export async function insertGeneratedHooks(
  db: Db,
  args: { projectId: string; story: StoryRef; hooks: readonly GeneratedHook[]; provider: string; model: string },
): Promise<ServiceResult<{ ids: string[] }>> {
  return guarded("scripts.insert_hooks_failed", async () => {
    if (args.hooks.length === 0) return success({ ids: [] });
    const rows = must(
      await db
        .from("hooks")
        .insert(
          args.hooks.map((h) => ({
            project_id: args.projectId,
            story_id: args.story.id,
            opportunity_id: args.story.opportunityId,
            hook_type: h.hookType,
            text: h.text,
            angle: h.angle,
            score: h.score,
            score_explanation: h.explanation as unknown as Json,
            provider: args.provider,
            model: args.model,
          })),
        )
        .select("id"),
    );
    return success({ ids: (rows ?? []).map((r) => r.id) });
  });
}

/* ------------------------------------------------------------------------- */
/* background jobs                                                           */
/* ------------------------------------------------------------------------- */

type StudioJobType = "script.generate" | "hooks.generate" | "script.transform";

/** Pending/running jobs of a type whose payload points at one of the entities. */
export async function findActiveJobs(
  db: Db,
  projectId: string,
  type: StudioJobType,
  payloadKey: "storyId" | "scriptId",
  entityIds: readonly string[],
): Promise<(ActiveJob & { entityId: string; operation: string | null })[]> {
  if (entityIds.length === 0) return [];
  const { data, error } = await db
    .from("jobs")
    .select("id, status, payload")
    .eq("project_id", projectId)
    .eq("type", type)
    .in(`payload->>${payloadKey}`, entityIds.slice(0, CHUNK))
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    logger.warn("scripts.find_active_jobs_failed", { code: error.code });
    return [];
  }
  return (data ?? []).map((j) => {
    const payload = (j.payload ?? {}) as Record<string, unknown>;
    return {
      id: j.id,
      status: j.status as ActiveJob["status"],
      entityId: String(payload[payloadKey] ?? ""),
      operation: typeof payload.operation === "string" ? payload.operation : null,
    };
  });
}

