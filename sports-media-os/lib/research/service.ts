import { canonicalizeUrl } from "@/lib/connectors/normalize";
import type { Db, Enums, Tables } from "@/lib/db/client";
import { summariseEvidence, type EvidenceSummary } from "@/lib/factcheck/evidence";
import { normaliseForCompare, readStoredSuggestion, type StoredSuggestion } from "@/lib/factcheck/sanitize";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

import type { ExistingResearchText, SanitisedSuggestions } from "./ai-suggest";
import { computeProgress, researchGaps, type ResearchGap, type ResearchProgress } from "./progress";
import {
  MEDIA_SOURCE_TYPE,
  publisherFor,
  readItemMeta,
  RESEARCH_ITEM_TYPES,
  toItemColumns,
  type ClaimRelation,
  type FactStatus,
  type ItemMeta,
  type ResearchItemInput,
  type ResearchItemType,
  type SourceFormInput,
  type SourceType,
} from "./schema";

/**
 * Research Workspace — DB logic. Every function takes the DB client first, so
 * the same code runs as the signed-in user (RLS) and in the worker (service
 * role). Every query is ALSO filtered by the project id passed in.
 *
 * DB rules this code relies on (never re-implemented here):
 * - a critical claim is 'confirmed' only with a 'supports' source (CLAIM_UNSOURCED)
 * - removing the last supporting source downgrades it to 'uncertain'
 * - quotes / media / competitors need a source or a link
 * - checked_by / checked_at are stamped by the DB, never sent from here
 * - composite FKs: a claim can only link a source of its own project
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

/* ------------------------------------------------------------------------- */
/* read models                                                               */
/* ------------------------------------------------------------------------- */

const OPPORTUNITY_COLUMNS = "id, title, description, why_now, angle, hook, competition, status, trend_id, sport_id, created_at";
const ITEM_COLUMNS =
  "id, opportunity_id, item_type, title, content, url, occurred_at, source_id, position, created_at, updated_at, created_by_agent, metadata";
const FACT_COLUMNS =
  "id, claim, status, confidence, is_critical, notes, checked_at, checked_by, checked_by_agent, ai_suggestion, created_at, updated_at";
const SOURCE_COLUMNS = "id, name, title, url, source_type, summary, published_at, rights_status, usable_in_production, license_status";

type SourceRow = Pick<
  Tables<"sources">,
  "id" | "name" | "title" | "url" | "source_type" | "summary" | "published_at" | "rights_status" | "usable_in_production" | "license_status"
>;
type ItemRow = Pick<
  Tables<"research_items">,
  | "id"
  | "opportunity_id"
  | "item_type"
  | "title"
  | "content"
  | "url"
  | "occurred_at"
  | "source_id"
  | "position"
  | "created_at"
  | "updated_at"
  | "created_by_agent"
  | "metadata"
>;
type FactRow = Pick<
  Tables<"facts">,
  | "id"
  | "claim"
  | "status"
  | "confidence"
  | "is_critical"
  | "notes"
  | "checked_at"
  | "checked_by"
  | "checked_by_agent"
  | "ai_suggestion"
  | "created_at"
  | "updated_at"
>;
type LinkRow = Pick<Tables<"fact_sources">, "fact_id" | "source_id" | "relation" | "excerpt" | "locator" | "created_at">;

export type WorkspaceOpportunity = Pick<
  Tables<"opportunities">,
  "id" | "title" | "description" | "why_now" | "angle" | "hook" | "competition" | "status" | "trend_id" | "sport_id" | "created_at"
>;

/** An asset reference with its current rights state (rights belong to sources, never to stories). */
export type SourceRef = {
  id: string;
  name: string;
  title: string | null;
  url: string;
  sourceType: SourceType;
  rightsStatus: Enums<"rights_status">;
  usableInProduction: boolean;
};

export type SourceOrigin = "research" | "claim" | "trend";

export type WorkspaceSource = SourceRef & {
  summary: string | null;
  publishedAt: string | null;
  licenseStatus: Enums<"license_status">;
  /** how the source entered this workspace */
  origins: SourceOrigin[];
  /** research item types that reference it (article, video, media, quote, …) */
  itemTypes: ResearchItemType[];
  /** number of claims linked to it */
  claimLinks: number;
  /** YELLOW waiting for a human rights approval */
  awaitingApproval: boolean;
};

export type ResearchItemView = {
  id: string;
  type: ResearchItemType;
  title: string | null;
  content: string | null;
  url: string | null;
  occurredAt: string | null;
  sourceId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  createdByAgent: Enums<"agent_key"> | null;
  meta: ItemMeta;
  source: SourceRef | null;
};

export type ClaimLinkView = {
  sourceId: string;
  relation: ClaimRelation;
  excerpt: string | null;
  locator: string | null;
  createdAt: string;
  source: SourceRef | null;
};

export type ClaimView = {
  id: string;
  claim: string;
  status: FactStatus;
  confidence: number | null;
  isCritical: boolean;
  notes: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  checkedByName: string | null;
  checkedByAgent: Enums<"agent_key"> | null;
  createdAt: string;
  updatedAt: string;
  links: ClaimLinkView[];
  evidence: EvidenceSummary;
  aiSuggestion: StoredSuggestion | null;
  /** a fact-check assist job still pending/running for this claim */
  activeJobId: string | null;
};

export type ResearchJobRef = {
  id: string;
  status: Enums<"job_status">;
  createdAt: string;
  finishedAt: string | null;
  result: Json | null;
  errorMessage: string | null;
};

export type Workspace = {
  opportunity: WorkspaceOpportunity;
  items: Record<ResearchItemType, ResearchItemView[]>;
  claims: ClaimView[];
  sources: WorkspaceSource[];
  progress: ResearchProgress;
  gaps: ResearchGap[];
  /** latest AI research-suggest job for this opportunity (any status) */
  researchJob: ResearchJobRef | null;
};

function toSourceRef(s: SourceRow): SourceRef {
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    url: s.url,
    sourceType: s.source_type,
    rightsStatus: s.rights_status,
    usableInProduction: s.usable_in_production,
  };
}

function emptyItemGroups(): Record<ResearchItemType, ResearchItemView[]> {
  return Object.fromEntries(RESEARCH_ITEM_TYPES.map((t) => [t, []])) as unknown as Record<ResearchItemType, ResearchItemView[]>;
}

async function loadOpportunity(db: Db, projectId: string, opportunityId: string): Promise<WorkspaceOpportunity | null> {
  return must(
    await db.from("opportunities").select(OPPORTUNITY_COLUMNS).eq("id", opportunityId).eq("project_id", projectId).maybeSingle(),
  );
}

/** The project's opportunity (id + title), or NOT_FOUND — checked by actions before enqueueing AI work. */
export async function getOpportunityRef(
  db: Db,
  projectId: string,
  opportunityId: string,
): Promise<ServiceResult<{ id: string; title: string }>> {
  return guarded("research.get_opportunity_failed", async () => {
    const o = await loadOpportunity(db, projectId, opportunityId);
    return o ? success({ id: o.id, title: o.title }) : notFound("opportunity");
  });
}

async function loadLinks(db: Db, projectId: string, factIds: string[]): Promise<LinkRow[]> {
  return inChunks(factIds, (chunk) =>
    db
      .from("fact_sources")
      .select("fact_id, source_id, relation, excerpt, locator, created_at")
      .in("fact_id", chunk)
      .eq("project_id", projectId)
      .order("created_at"),
  );
}

async function loadSources(db: Db, projectId: string, ids: string[]): Promise<SourceRow[]> {
  return inChunks(ids, (chunk) => db.from("sources").select(SOURCE_COLUMNS).in("id", chunk).eq("project_id", projectId));
}

async function loadTrendSourceIds(db: Db, projectId: string, trendId: string | null): Promise<string[]> {
  if (!trendId) return [];
  const rows = must(await db.from("trend_sources").select("source_id").eq("trend_id", trendId).eq("project_id", projectId)) ?? [];
  return rows.map((r) => r.source_id);
}

/** Names of the people who last checked claims (RLS: co-members only; failures just hide names). */
async function loadPeople(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("users").select("id, display_name, email").in("id", ids);
  if (error) {
    logger.warn("research.load_people_failed", { code: error.code });
    return new Map();
  }
  return new Map((data ?? []).map((u) => [u.id, u.display_name || u.email]));
}

function sortItems(groups: Record<ResearchItemType, ResearchItemView[]>) {
  const byPosition = (a: ResearchItemView, b: ResearchItemView) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);
  for (const type of RESEARCH_ITEM_TYPES) groups[type].sort(byPosition);
  // timeline: chronological, undated events last
  groups.timeline.sort((a, b) => (a.occurredAt ?? "9999").localeCompare(b.occurredAt ?? "9999") || byPosition(a, b));
  // questions: open first
  groups.question.sort((a, b) => Number(a.meta.answered) - Number(b.meta.answered) || byPosition(a, b));
  // competitors: newest first
  groups.competitor.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "") || byPosition(a, b));
}

/**
 * Everything the workspace shows for one opportunity: items grouped by type,
 * claims with their linked sources and evidence, every source in play (from
 * research items, claim links and the opportunity's trend) with its rights
 * state, progress counts and gaps.
 */
export async function loadWorkspace(db: Db, projectId: string, opportunityId: string): Promise<ServiceResult<Workspace>> {
  return guarded("research.load_workspace_failed", async () => {
    const opportunity = await loadOpportunity(db, projectId, opportunityId);
    if (!opportunity) return notFound("opportunity");

    const [itemsRes, factsRes, trendSourceIds, researchJobRes, factJobsRes] = await Promise.all([
      db
        .from("research_items")
        .select(ITEM_COLUMNS)
        .eq("opportunity_id", opportunity.id)
        .eq("project_id", projectId)
        .order("position")
        .order("created_at"),
      db.from("facts").select(FACT_COLUMNS).eq("opportunity_id", opportunity.id).eq("project_id", projectId).order("created_at"),
      loadTrendSourceIds(db, projectId, opportunity.trend_id),
      db
        .from("jobs")
        .select("id, status, created_at, finished_at, result, error_message")
        .eq("project_id", projectId)
        .eq("type", "research.suggest")
        .eq("payload->>opportunityId", opportunity.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("jobs")
        .select("id, payload")
        .eq("project_id", projectId)
        .eq("type", "factcheck.assist")
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const items: ItemRow[] = must(itemsRes) ?? [];
    const facts: FactRow[] = must(factsRes) ?? [];
    const researchJob = must(researchJobRes);
    const factJobs = must(factJobsRes) ?? [];

    const links = await loadLinks(
      db,
      projectId,
      facts.map((f) => f.id),
    );
    const sourceIds = uniq([...items.map((i) => i.source_id), ...links.map((l) => l.source_id), ...trendSourceIds]);
    const [sourceRows, people] = await Promise.all([
      loadSources(db, projectId, sourceIds),
      loadPeople(db, uniq(facts.map((f) => f.checked_by))),
    ]);
    const sourceById = new Map(sourceRows.map((s) => [s.id, s]));
    const refOf = (id: string | null) => {
      const s = id ? sourceById.get(id) : undefined;
      return s ? toSourceRef(s) : null;
    };

    // items
    const groups = emptyItemGroups();
    for (const i of items) {
      groups[i.item_type].push({
        id: i.id,
        type: i.item_type,
        title: i.title,
        content: i.content,
        url: i.url,
        occurredAt: i.occurred_at,
        sourceId: i.source_id,
        position: i.position,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        createdByAgent: i.created_by_agent,
        meta: readItemMeta(i.metadata),
        source: refOf(i.source_id),
      });
    }
    sortItems(groups);

    // claims
    const activeJobByFact = new Map<string, string>();
    for (const j of factJobs) {
      const factId = (j.payload as { factId?: unknown } | null)?.factId;
      if (typeof factId === "string" && !activeJobByFact.has(factId)) activeJobByFact.set(factId, j.id);
    }
    const linksByFact = new Map<string, LinkRow[]>();
    for (const l of links) linksByFact.set(l.fact_id, [...(linksByFact.get(l.fact_id) ?? []), l]);
    const claims: ClaimView[] = facts.map((f) => {
      const own = linksByFact.get(f.id) ?? [];
      return {
        id: f.id,
        claim: f.claim,
        status: f.status,
        confidence: f.confidence,
        isCritical: f.is_critical,
        notes: f.notes,
        checkedAt: f.checked_at,
        checkedBy: f.checked_by,
        checkedByName: f.checked_by ? (people.get(f.checked_by) ?? null) : null,
        checkedByAgent: f.checked_by_agent,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
        links: own.map((l) => ({
          sourceId: l.source_id,
          relation: l.relation,
          excerpt: l.excerpt,
          locator: l.locator,
          createdAt: l.created_at,
          source: refOf(l.source_id),
        })),
        evidence: summariseEvidence(own, f.is_critical),
        aiSuggestion: readStoredSuggestion(f.ai_suggestion),
        activeJobId: activeJobByFact.get(f.id) ?? null,
      };
    });

    // sources in play
    const trendSet = new Set(trendSourceIds);
    const sources: WorkspaceSource[] = sourceRows.map((s) => {
      const itemTypes = uniq(items.filter((i) => i.source_id === s.id).map((i) => i.item_type));
      const claimLinks = links.filter((l) => l.source_id === s.id).length;
      const origins: SourceOrigin[] = [];
      if (itemTypes.length) origins.push("research");
      if (claimLinks) origins.push("claim");
      if (trendSet.has(s.id)) origins.push("trend");
      return {
        ...toSourceRef(s),
        summary: s.summary,
        publishedAt: s.published_at,
        licenseStatus: s.license_status,
        origins,
        itemTypes,
        claimLinks,
        awaitingApproval: s.rights_status === "yellow" && !s.usable_in_production,
      };
    });
    sources.sort(
      (a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );

    const progress = computeProgress({
      sourceCount: sources.length,
      items,
      claims: claims.map((c) => ({ status: c.status, is_critical: c.isCritical, supports: c.evidence.supports, links: c.evidence.total })),
      mediaAssets: groups.media.map((m) => {
        const s = m.sourceId ? sourceById.get(m.sourceId) : undefined;
        return s ? { rights_status: s.rights_status, usable_in_production: s.usable_in_production } : null;
      }),
    });

    return success({
      opportunity,
      items: groups,
      claims,
      sources,
      progress,
      gaps: researchGaps(progress),
      researchJob: researchJob
        ? {
            id: researchJob.id,
            status: researchJob.status,
            createdAt: researchJob.created_at,
            finishedAt: researchJob.finished_at,
            result: researchJob.result,
            errorMessage: researchJob.error_message,
          }
        : null,
    });
  });
}

export type ResearchOverviewRow = {
  id: string;
  title: string;
  status: Enums<"opportunity_status">;
  competition: string | null;
  createdAt: string;
  progress: ResearchProgress;
  blockers: number;
};

/**
 * Research progress for the project's opportunities (newest first, archived
 * and rejected ones left out). Sources count research items, claim links and
 * the trend's sources — the same set the workspace shows.
 */
export async function listResearchOverview(
  db: Db,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<ServiceResult<ResearchOverviewRow[]>> {
  return guarded("research.list_overview_failed", async () => {
    const opps =
      must(
        await db
          .from("opportunities")
          .select("id, title, status, competition, trend_id, created_at")
          .eq("project_id", projectId)
          .not("status", "in", "(archived,rejected)")
          .order("created_at", { ascending: false })
          .limit(Math.min(Math.max(opts.limit ?? 100, 1), 200)),
      ) ?? [];
    if (opps.length === 0) return success([]);
    const oppIds = opps.map((o) => o.id);
    const trendIds = uniq(opps.map((o) => o.trend_id));

    const [items, facts, trendLinks] = await Promise.all([
      inChunks(oppIds, (chunk) =>
        db.from("research_items").select("opportunity_id, item_type, metadata, source_id").in("opportunity_id", chunk).eq("project_id", projectId),
      ),
      inChunks(oppIds, (chunk) =>
        db.from("facts").select("id, opportunity_id, status, is_critical").in("opportunity_id", chunk).eq("project_id", projectId),
      ),
      inChunks(trendIds, (chunk) => db.from("trend_sources").select("trend_id, source_id").in("trend_id", chunk).eq("project_id", projectId)),
    ]);
    const links = await inChunks(
      facts.map((f) => f.id),
      (chunk) => db.from("fact_sources").select("fact_id, source_id, relation").in("fact_id", chunk).eq("project_id", projectId),
    );
    const mediaSourceIds = uniq(items.filter((i) => i.item_type === "media").map((i) => i.source_id));
    const mediaSources = await inChunks(mediaSourceIds, (chunk) =>
      db.from("sources").select("id, rights_status, usable_in_production").in("id", chunk).eq("project_id", projectId),
    );
    const mediaById = new Map(mediaSources.map((s) => [s.id, s]));

    const rows = opps.map((o) => {
      const ownItems = items.filter((i) => i.opportunity_id === o.id);
      const ownFacts = facts.filter((f) => f.opportunity_id === o.id);
      const ownFactIds = new Set(ownFacts.map((f) => f.id));
      const ownLinks = links.filter((l) => ownFactIds.has(l.fact_id));
      const sourceIds = new Set<string>();
      for (const i of ownItems) if (i.source_id) sourceIds.add(i.source_id);
      for (const l of ownLinks) sourceIds.add(l.source_id);
      if (o.trend_id) for (const t of trendLinks) if (t.trend_id === o.trend_id) sourceIds.add(t.source_id);

      const progress = computeProgress({
        sourceCount: sourceIds.size,
        items: ownItems,
        claims: ownFacts.map((f) => {
          const fl = ownLinks.filter((l) => l.fact_id === f.id);
          return { status: f.status, is_critical: f.is_critical, links: fl.length, supports: fl.filter((l) => l.relation === "supports").length };
        }),
        mediaAssets: ownItems
          .filter((i) => i.item_type === "media")
          .map((i) => (i.source_id ? (mediaById.get(i.source_id) ?? null) : null)),
      });
      return {
        id: o.id,
        title: o.title,
        status: o.status,
        competition: o.competition,
        createdAt: o.created_at,
        progress,
        blockers: researchGaps(progress).filter((g) => g.severity === "blocker").length,
      };
    });
    return success(rows);
  });
}

/* ------------------------------------------------------------------------- */
/* sources                                                                   */
/* ------------------------------------------------------------------------- */

type EnsureSourceInput = {
  url: string;
  name: string;
  title: string | null;
  sourceType: SourceType;
  summary: string | null;
};

/**
 * Reuse the project's source for this link (same canonical URL, the dedupe key
 * connectors use) or create it. A new source starts 'unchecked': rights are
 * classified in the Rights Center, never here.
 */
async function ensureSource(db: Db, projectId: string, input: EnsureSourceInput): Promise<{ id: string; existing: boolean }> {
  const canonical = canonicalizeUrl(input.url);
  if (!canonical) throw new QueryFailed({ code: "22023", message: "invalid url", userMessage: "Paste a full http(s) link." });
  // also match a legacy, non-canonical copy of the same link (values with quotes/backslashes can't go in an in() filter)
  const raw = input.url.trim();
  const candidates = uniq([canonical, /["\\]/.test(raw) ? null : raw]);
  const find = async () =>
    must(await db.from("sources").select("id").eq("project_id", projectId).in("url", candidates).limit(1).maybeSingle());

  const found = await find();
  if (found) return { id: found.id, existing: true };

  const { data, error } = await db
    .from("sources")
    .insert({
      project_id: projectId,
      name: input.name,
      title: input.title,
      url: canonical,
      source_type: input.sourceType,
      summary: input.summary,
      metadata: { added_from: "research" },
    })
    .select("id")
    .single();
  if (error) {
    // created concurrently (unique project_id + url): reuse it
    if (error.code === "23505") {
      const again = await find();
      if (again) return { id: again.id, existing: true };
    }
    throw new QueryFailed(error);
  }
  return { id: data.id, existing: false };
}

async function nextPosition(db: Db, projectId: string, opportunityId: string, type: ResearchItemType): Promise<number> {
  const last = must(
    await db
      .from("research_items")
      .select("position")
      .eq("project_id", projectId)
      .eq("opportunity_id", opportunityId)
      .eq("item_type", type)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return (last?.position ?? -1) + 1;
}

export type AddSourceResult = { sourceId: string; existingSource: boolean; itemId: string | null; alreadyLinked: boolean };

/**
 * Add a source to the workspace: insert it (canonical URL) or reuse the
 * project's existing one, then link it to the opportunity as an article/video
 * research item (once).
 */
export async function addSource(
  db: Db,
  args: { projectId: string; opportunityId: string; userId: string | null; input: SourceFormInput },
): Promise<ServiceResult<AddSourceResult>> {
  return guarded<AddSourceResult>("research.add_source_failed", async () => {
    const { projectId, opportunityId, input } = args;
    const opportunity = await loadOpportunity(db, projectId, opportunityId);
    if (!opportunity) return notFound("opportunity");

    const source = await ensureSource(db, projectId, {
      url: input.url,
      name: publisherFor(input.url, input.publisher),
      title: input.title,
      sourceType: input.type,
      summary: input.summary,
    });

    const linked = must(
      await db
        .from("research_items")
        .select("id")
        .eq("project_id", projectId)
        .eq("opportunity_id", opportunityId)
        .eq("source_id", source.id)
        .in("item_type", ["article", "video"])
        .limit(1)
        .maybeSingle(),
    );
    if (linked) return success({ sourceId: source.id, existingSource: source.existing, itemId: linked.id, alreadyLinked: true });

    const stored = mustOne(await db.from("sources").select("name, title, url").eq("id", source.id).eq("project_id", projectId).single());
    const itemType: ResearchItemType = input.type === "video" ? "video" : "article";
    const item = mustOne(
      await db
        .from("research_items")
        .insert({
          project_id: projectId,
          opportunity_id: opportunityId,
          source_id: source.id,
          item_type: itemType,
          title: (input.title ?? stored.title ?? stored.name).slice(0, 500),
          url: stored.url,
          content: input.summary,
          position: await nextPosition(db, projectId, opportunityId, itemType),
          created_by: args.userId,
          metadata: { added_from: "research", publisher: stored.name },
        })
        .select("id")
        .single(),
    );
    return success({ sourceId: source.id, existingSource: source.existing, itemId: item.id, alreadyLinked: false });
  });
}

/* ------------------------------------------------------------------------- */
/* research items                                                            */
/* ------------------------------------------------------------------------- */

/** article / video / media / quote with a link but no source picked → source record (rights live on sources) */
function sourceFor(input: ResearchItemInput): EnsureSourceInput | null {
  switch (input.type) {
    case "article":
    case "video":
      return input.sourceId ? null : { url: input.url, name: publisherFor(input.url, null), title: input.title, sourceType: input.type === "video" ? "video" : "news", summary: input.content };
    case "media":
      return input.sourceId ? null : { url: input.url, name: publisherFor(input.url, null), title: input.title, sourceType: MEDIA_SOURCE_TYPE[input.mediaKind], summary: null };
    case "quote":
      return input.sourceId || !input.url ? null : { url: input.url, name: publisherFor(input.url, null), title: null, sourceType: "news", summary: null };
    default:
      // competitors are other channels' videos: logged as links, never as our sources/assets
      return null;
  }
}

export async function createItem(
  db: Db,
  args: { projectId: string; opportunityId: string; userId: string | null; input: ResearchItemInput },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("research.create_item_failed", async () => {
    const { projectId, opportunityId, input } = args;
    const opportunity = await loadOpportunity(db, projectId, opportunityId);
    if (!opportunity) return notFound("opportunity");

    const columns = toItemColumns(input);
    const ensure = sourceFor(input);
    if (ensure) columns.source_id = (await ensureSource(db, projectId, ensure)).id;

    const item = mustOne(
      await db
        .from("research_items")
        .insert({
          ...columns,
          project_id: projectId,
          opportunity_id: opportunityId,
          position: await nextPosition(db, projectId, opportunityId, columns.item_type),
          created_by: args.userId,
        })
        .select("id")
        .single(),
    );
    return success({ id: item.id });
  });
}

async function loadItem(db: Db, projectId: string, itemId: string) {
  return must(
    await db
      .from("research_items")
      .select("id, opportunity_id, item_type, metadata")
      .eq("id", itemId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
}

const asObject = (v: Json | null | undefined): { [key: string]: Json } =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...(v as { [key: string]: Json }) } : {};

/** Edit an item; its type never changes. Agent provenance in metadata (ai, model) is kept. */
export async function updateItem(
  db: Db,
  args: { projectId: string; itemId: string; input: ResearchItemInput },
): Promise<ServiceResult<{ id: string; opportunityId: string }>> {
  return guarded("research.update_item_failed", async () => {
    const { projectId, itemId, input } = args;
    const current = await loadItem(db, projectId, itemId);
    if (!current) return notFound("research item");
    if (current.item_type !== input.type) return invalid("The item type cannot be changed.");

    const columns = toItemColumns(input);
    const ensure = sourceFor(input);
    if (ensure) columns.source_id = (await ensureSource(db, projectId, ensure)).id;

    const metadata = { ...asObject(current.metadata), ...columns.metadata };
    if (input.type === "question") {
      const wasAnswered = readItemMeta(current.metadata).answered;
      if (input.answered && !wasAnswered) metadata.answered_at = new Date().toISOString();
      if (!input.answered) metadata.answered_at = null;
    }
    const updated = must(
      await db
        .from("research_items")
        .update({
          title: columns.title,
          content: columns.content,
          url: columns.url,
          occurred_at: columns.occurred_at,
          source_id: columns.source_id,
          metadata,
        })
        .eq("id", itemId)
        .eq("project_id", projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return notFound("research item");
    return success({ id: itemId, opportunityId: current.opportunity_id });
  });
}

/** Deleting research is an admin action (RLS); a refused delete reports a permission error. */
export async function deleteItem(
  db: Db,
  args: { projectId: string; itemId: string },
): Promise<ServiceResult<{ opportunityId: string }>> {
  return guarded("research.delete_item_failed", async () => {
    const current = await loadItem(db, args.projectId, args.itemId);
    if (!current) return notFound("research item");
    const deleted = must(
      await db.from("research_items").delete().eq("id", args.itemId).eq("project_id", args.projectId).select("id"),
    );
    if (!deleted?.length) return failure({ code: "42501", message: "delete refused by RLS" });
    return success({ opportunityId: current.opportunity_id });
  });
}

/** Mark a question answered (with the answer) or reopen it. */
export async function answerQuestion(
  db: Db,
  args: { projectId: string; itemId: string; answered: boolean; answer: string | null; userId: string | null },
): Promise<ServiceResult<{ opportunityId: string }>> {
  return guarded("research.answer_question_failed", async () => {
    const current = await loadItem(db, args.projectId, args.itemId);
    if (!current) return notFound("question");
    if (current.item_type !== "question") return invalid("Only questions can be answered.");
    if (args.answered && !args.answer) return invalid("Write the answer before marking it answered.");

    const metadata = asObject(current.metadata);
    metadata.answered = args.answered;
    if (args.answer !== null) metadata.answer = args.answer;
    metadata.answered_at = args.answered ? new Date().toISOString() : null;
    metadata.answered_by = args.answered ? args.userId : null;

    const updated = must(
      await db
        .from("research_items")
        .update({ metadata })
        .eq("id", args.itemId)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return notFound("question");
    return success({ opportunityId: current.opportunity_id });
  });
}

/* ------------------------------------------------------------------------- */
/* claims                                                                    */
/* ------------------------------------------------------------------------- */

async function loadFact(db: Db, projectId: string, factId: string) {
  return must(
    await db
      .from("facts")
      .select("id, claim, status, is_critical, notes, opportunity_id, ai_suggestion")
      .eq("id", factId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
}

/** New claims start 'uncertain' and critical unless said otherwise; the same text twice is refused. */
export async function createClaim(
  db: Db,
  args: { projectId: string; opportunityId: string; claim: string; isCritical?: boolean },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("research.create_claim_failed", async () => {
    const { projectId, opportunityId } = args;
    const opportunity = await loadOpportunity(db, projectId, opportunityId);
    if (!opportunity) return notFound("opportunity");

    const existing = must(await db.from("facts").select("claim").eq("project_id", projectId).eq("opportunity_id", opportunityId)) ?? [];
    const key = normaliseForCompare(args.claim);
    if (existing.some((f) => normaliseForCompare(f.claim) === key)) return invalid("This claim is already listed.");

    const fact = mustOne(
      await db
        .from("facts")
        .insert({
          project_id: projectId,
          opportunity_id: opportunityId,
          claim: args.claim,
          is_critical: args.isCritical ?? true,
          status: "uncertain",
        })
        .select("id")
        .single(),
    );
    return success({ id: fact.id });
  });
}

/**
 * Edit the claim text / critical flag. Changing the text resets a verified
 * claim to 'uncertain' (the old verification was about other words); making a
 * confirmed claim critical without a supporting source is refused by the DB.
 */
export async function updateClaim(
  db: Db,
  args: { projectId: string; factId: string; claim: string; isCritical: boolean },
): Promise<ServiceResult<{ opportunityId: string | null; statusReset: boolean }>> {
  return guarded("research.update_claim_failed", async () => {
    const current = await loadFact(db, args.projectId, args.factId);
    if (!current) return notFound("claim");
    const textChanged = normaliseForCompare(current.claim) !== normaliseForCompare(args.claim);
    const statusReset = textChanged && current.status !== "uncertain";

    const updated = must(
      await db
        .from("facts")
        .update({
          claim: args.claim,
          is_critical: args.isCritical,
          ...(statusReset ? { status: "uncertain" as const, confidence: null } : {}),
        })
        .eq("id", args.factId)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return notFound("claim");
    return success({ opportunityId: current.opportunity_id, statusReset });
  });
}

export async function deleteClaim(
  db: Db,
  args: { projectId: string; factId: string },
): Promise<ServiceResult<{ opportunityId: string | null }>> {
  return guarded("research.delete_claim_failed", async () => {
    const current = await loadFact(db, args.projectId, args.factId);
    if (!current) return notFound("claim");
    const deleted = must(await db.from("facts").delete().eq("id", args.factId).eq("project_id", args.projectId).select("id"));
    if (!deleted?.length) return failure({ code: "42501", message: "delete refused by RLS" });
    return success({ opportunityId: current.opportunity_id });
  });
}

/**
 * Link a source to a claim (or update an existing link's relation, excerpt and
 * locator). A source of another project is refused by the composite FK.
 */
export async function linkClaimSource(
  db: Db,
  args: {
    projectId: string;
    factId: string;
    sourceId: string;
    relation: ClaimRelation;
    excerpt: string | null;
    locator: string | null;
    userId: string | null;
  },
): Promise<ServiceResult<{ opportunityId: string | null; updated: boolean }>> {
  return guarded<{ opportunityId: string | null; updated: boolean }>("research.link_source_failed", async () => {
    const { projectId, factId, sourceId } = args;
    const fact = await loadFact(db, projectId, factId);
    if (!fact) return notFound("claim");

    const existing = must(
      await db
        .from("fact_sources")
        .select("fact_id")
        .eq("fact_id", factId)
        .eq("source_id", sourceId)
        .eq("project_id", projectId)
        .maybeSingle(),
    );
    if (existing) {
      must(
        await db
          .from("fact_sources")
          .update({ relation: args.relation, excerpt: args.excerpt, locator: args.locator })
          .eq("fact_id", factId)
          .eq("source_id", sourceId)
          .eq("project_id", projectId)
          .select("fact_id")
          .maybeSingle(),
      );
      return success({ opportunityId: fact.opportunity_id, updated: true });
    }

    must(
      await db
        .from("fact_sources")
        .insert({
          project_id: projectId,
          fact_id: factId,
          source_id: sourceId,
          relation: args.relation,
          excerpt: args.excerpt,
          locator: args.locator,
          created_by: args.userId,
        })
        .select("fact_id")
        .single(),
    );
    return success({ opportunityId: fact.opportunity_id, updated: false });
  });
}

/** Change only the relation of an existing link (e.g. applying a suggested relation). */
export async function setLinkRelation(
  db: Db,
  args: { projectId: string; factId: string; sourceId: string; relation: ClaimRelation },
): Promise<ServiceResult<{ opportunityId: string | null; status: FactStatus }>> {
  return guarded("research.set_link_relation_failed", async () => {
    const fact = await loadFact(db, args.projectId, args.factId);
    if (!fact) return notFound("claim");
    const updated = must(
      await db
        .from("fact_sources")
        .update({ relation: args.relation })
        .eq("fact_id", args.factId)
        .eq("source_id", args.sourceId)
        .eq("project_id", args.projectId)
        .select("fact_id")
        .maybeSingle(),
    );
    if (!updated) return notFound("source link");
    const after = await loadFact(db, args.projectId, args.factId);
    return success({ opportunityId: fact.opportunity_id, status: after?.status ?? fact.status });
  });
}

/** Unlink a source; when it was the last supporting one, the DB downgrades a confirmed critical claim. */
export async function unlinkClaimSource(
  db: Db,
  args: { projectId: string; factId: string; sourceId: string },
): Promise<ServiceResult<{ opportunityId: string | null; downgraded: boolean }>> {
  return guarded("research.unlink_source_failed", async () => {
    const before = await loadFact(db, args.projectId, args.factId);
    if (!before) return notFound("claim");
    const deleted = must(
      await db
        .from("fact_sources")
        .delete()
        .eq("fact_id", args.factId)
        .eq("source_id", args.sourceId)
        .eq("project_id", args.projectId)
        .select("fact_id"),
    );
    if (!deleted?.length) return notFound("source link");
    const after = await loadFact(db, args.projectId, args.factId);
    return success({
      opportunityId: before.opportunity_id,
      downgraded: before.status === "confirmed" && after?.status !== "confirmed",
    });
  });
}

/**
 * Human verification: status + confidence (0..1) + notes. Who/when is stamped
 * by the DB; 'confirmed' on a critical claim without a supporting source is
 * refused (CLAIM_UNSOURCED).
 */
export async function setClaimStatus(
  db: Db,
  args: { projectId: string; factId: string; status: FactStatus; confidence: number | null; notes: string | null },
): Promise<ServiceResult<{ opportunityId: string | null }>> {
  return guarded("research.set_claim_status_failed", async () => {
    const fact = await loadFact(db, args.projectId, args.factId);
    if (!fact) return notFound("claim");
    const updated = must(
      await db
        .from("facts")
        .update({ status: args.status, confidence: args.confidence, notes: args.notes })
        .eq("id", args.factId)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return notFound("claim");
    return success({ opportunityId: fact.opportunity_id });
  });
}

/* ------------------------------------------------------------------------- */
/* AI support (shared by actions and workers)                                */
/* ------------------------------------------------------------------------- */

export type ClaimEvidence = {
  fact: { id: string; claim: string; isCritical: boolean; status: FactStatus; notes: string | null; opportunityId: string | null };
  aiSuggestion: StoredSuggestion | null;
  sources: {
    id: string;
    title: string;
    publisher: string | null;
    url: string;
    summary: string | null;
    relation: ClaimRelation;
    excerpt: string | null;
    locator: string | null;
  }[];
};

/** The claim and ONLY its linked sources (what the fact-check model may see). */
export async function loadClaimEvidence(db: Db, projectId: string, factId: string): Promise<ServiceResult<ClaimEvidence>> {
  return guarded("research.load_claim_evidence_failed", async () => {
    const fact = await loadFact(db, projectId, factId);
    if (!fact) return notFound("claim");
    const links = await loadLinks(db, projectId, [fact.id]);
    const sources = await loadSources(
      db,
      projectId,
      links.map((l) => l.source_id),
    );
    const byId = new Map(sources.map((s) => [s.id, s]));
    return success({
      fact: {
        id: fact.id,
        claim: fact.claim,
        isCritical: fact.is_critical,
        status: fact.status,
        notes: fact.notes,
        opportunityId: fact.opportunity_id,
      },
      aiSuggestion: readStoredSuggestion(fact.ai_suggestion),
      sources: links.flatMap((l) => {
        const s = byId.get(l.source_id);
        if (!s) return [];
        return [
          {
            id: s.id,
            title: s.title ?? s.name,
            publisher: s.name,
            url: s.url,
            summary: s.summary,
            relation: l.relation,
            excerpt: l.excerpt,
            locator: l.locator,
          },
        ];
      }),
    });
  });
}

/** Store a fact-check assessment. ONLY ai_suggestion changes: status, confidence and checker stay untouched. */
export async function saveClaimAISuggestion(
  db: Db,
  args: { projectId: string; factId: string; suggestion: StoredSuggestion },
): Promise<ServiceResult<{ id: string }>> {
  return guarded("research.save_ai_suggestion_failed", async () => {
    const updated = must(
      await db
        .from("facts")
        .update({ ai_suggestion: args.suggestion as unknown as Json })
        .eq("id", args.factId)
        .eq("project_id", args.projectId)
        .select("id")
        .maybeSingle(),
    );
    if (!updated) return notFound("claim");
    return success({ id: updated.id });
  });
}

export type SuggestContext = {
  opportunity: {
    id: string;
    title: string;
    description: string | null;
    why_now: string | null;
    angle: string | null;
    hook: string | null;
    competition: string | null;
    sport: string | null;
  };
  sources: { id: string; title: string; summary: string | null; url: string; publisher: string | null }[];
  existing: ExistingResearchText;
};

/**
 * Input for the research assist: opportunity fields and the workspace's
 * sources (research items first, then claim links, then the trend's) — and the
 * texts already present, so suggestions never duplicate them.
 */
export async function loadSuggestContext(db: Db, projectId: string, opportunityId: string): Promise<ServiceResult<SuggestContext>> {
  return guarded("research.load_suggest_context_failed", async () => {
    const o = await loadOpportunity(db, projectId, opportunityId);
    if (!o) return notFound("opportunity");
    const [items, facts, trendSourceIds, sport] = await Promise.all([
      db
        .from("research_items")
        .select("item_type, title, content, source_id, position")
        .eq("opportunity_id", o.id)
        .eq("project_id", projectId)
        .order("position"),
      db.from("facts").select("id, claim").eq("opportunity_id", o.id).eq("project_id", projectId),
      loadTrendSourceIds(db, projectId, o.trend_id),
      o.sport_id ? db.from("sports").select("name").eq("id", o.sport_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    const itemRows = must(items) ?? [];
    const factRows = must(facts) ?? [];
    const links = await loadLinks(
      db,
      projectId,
      factRows.map((f) => f.id),
    );
    const orderedIds = uniq([
      ...itemRows.filter((i) => i.item_type !== "competitor").map((i) => i.source_id),
      ...links.map((l) => l.source_id),
      ...trendSourceIds,
    ]);
    const rows = await loadSources(db, projectId, orderedIds);
    const byId = new Map(rows.map((s) => [s.id, s]));

    const texts = (type: ResearchItemType) =>
      itemRows.filter((i) => i.item_type === type).flatMap((i) => [i.title, i.content].filter((t): t is string => Boolean(t)));
    return success({
      opportunity: {
        id: o.id,
        title: o.title,
        description: o.description,
        why_now: o.why_now,
        angle: o.angle,
        hook: o.hook,
        competition: o.competition,
        sport: must(sport)?.name ?? null,
      },
      sources: orderedIds.flatMap((id) => {
        const s = byId.get(id);
        return s ? [{ id: s.id, title: s.title ?? s.name, summary: s.summary, url: s.url, publisher: s.name }] : [];
      }),
      existing: {
        claims: factRows.map((f) => f.claim),
        questions: texts("question"),
        timeline: texts("timeline"),
        context: texts("context"),
      },
    });
  });
}

export type InsertedSuggestions = { claims: number; questions: number; timeline: number; context: number };

/**
 * Store sanitised AI research suggestions (worker, service role):
 * - claims as 'uncertain', checked_by_agent 'researcher', sources linked as
 *   'mentions' (the AI cannot assert 'supports')
 * - questions / timeline / context as research items with created_by_agent
 *   'researcher' and metadata {ai: true, model, …}
 * If linking the claims' sources fails, the new claims are removed again.
 */
export async function insertAISuggestions(
  db: Db,
  args: {
    projectId: string;
    opportunityId: string;
    suggestions: SanitisedSuggestions;
    meta: { provider: string; model: string; promptVersion: string; jobId: string | null };
  },
): Promise<ServiceResult<InsertedSuggestions>> {
  return guarded("research.insert_ai_suggestions_failed", async () => {
    const { projectId, opportunityId, suggestions: s, meta } = args;
    const aiMeta = { ai: true, model: meta.model, provider: meta.provider, prompt_version: meta.promptVersion, job_id: meta.jobId };
    const inserted: InsertedSuggestions = { claims: 0, questions: 0, timeline: 0, context: 0 };

    if (s.claims.length) {
      const facts =
        must(
          await db
            .from("facts")
            .insert(
              s.claims.map((c) => ({
                project_id: projectId,
                opportunity_id: opportunityId,
                claim: c.claim,
                is_critical: c.isCritical,
                status: "uncertain" as const,
                checked_by_agent: "researcher" as const,
                notes: `Suggested by the Researcher agent (${meta.model}) from the linked source${c.sourceIds.length === 1 ? "" : "s"}. Not verified: a person must check it.`,
              })),
            )
            .select("id, claim"),
        ) ?? [];
      const idByClaim = new Map(facts.map((f) => [f.claim, f.id]));
      const linkRows = s.claims.flatMap((c) => {
        const factId = idByClaim.get(c.claim);
        return factId
          ? c.sourceIds.map((sourceId) => ({ project_id: projectId, fact_id: factId, source_id: sourceId, relation: "mentions" as const }))
          : [];
      });
      if (linkRows.length) {
        const { error } = await db.from("fact_sources").insert(linkRows);
        if (error) {
          await db
            .from("facts")
            .delete()
            .in(
              "id",
              facts.map((f) => f.id),
            )
            .eq("project_id", projectId);
          throw new QueryFailed(error);
        }
      }
      inserted.claims = facts.length;
    }

    const items: {
      item_type: ResearchItemType;
      title: string | null;
      content: string | null;
      occurred_at: string | null;
      source_id: string | null;
      metadata: { [key: string]: Json };
    }[] = [
      ...s.questions.map((q) => ({
        item_type: "question" as const,
        title: null,
        content: q,
        occurred_at: null,
        source_id: null,
        metadata: { ...aiMeta, answered: false },
      })),
      ...s.timeline.map((t) => ({
        item_type: "timeline" as const,
        title: t.event,
        content: null,
        occurred_at: t.occurredAt,
        source_id: t.sourceIds[0] ?? null,
        metadata: { ...aiMeta, source_ids: t.sourceIds },
      })),
      ...s.context.map((c) => ({
        item_type: "context" as const,
        title: c.title,
        content: c.note,
        occurred_at: null,
        source_id: c.sourceIds[0] ?? null,
        metadata: { ...aiMeta, source_ids: c.sourceIds },
      })),
    ];
    if (items.length) {
      const start: Partial<Record<ResearchItemType, number>> = {};
      for (const type of uniq(items.map((i) => i.item_type))) start[type] = await nextPosition(db, projectId, opportunityId, type);
      const rows = items.map((i) => {
        const position = start[i.item_type] ?? 0;
        start[i.item_type] = position + 1;
        return { ...i, project_id: projectId, opportunity_id: opportunityId, position, created_by_agent: "researcher" as const };
      });
      must(await db.from("research_items").insert(rows).select("id"));
      inserted.questions = s.questions.length;
      inserted.timeline = s.timeline.length;
      inserted.context = s.context.length;
    }
    return success(inserted);
  });
}

/** Pending/running AI job of a type for an entity (dedupes double clicks before enqueueing). */
export async function findActiveJob(
  db: Db,
  projectId: string,
  type: "research.suggest" | "factcheck.assist",
  payloadKey: "opportunityId" | "factId",
  entityId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id")
    .eq("project_id", projectId)
    .eq("type", type)
    .eq(`payload->>${payloadKey}`, entityId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("research.find_active_job_failed", { code: error.code });
    return null;
  }
  return data?.id ?? null;
}
