import { canonicalizeUrl } from "@/lib/connectors/normalize";
import type { Db, Enums, Tables } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

import { EDITORIAL_FORMATS, type EditorialFormat, type StoryMaterial } from "./alternatives";
import type { Ownership } from "./classify";
import {
  hasLocationMention,
  hasNumericStatistic,
  kindToSourceType,
  orIlikeFilter,
  publisherFromUrl,
  TYPE_FILTERS,
  type AssetRightsStatus,
  type AssetType,
  type ClassificationFields,
  type ClassifiedStatus,
  type RegisterAssetInput,
  type RightsFilters,
} from "./schema";

/**
 * Rights Center — DB logic. Every function takes the DB client first, so the
 * same code runs as the signed-in user (RLS) and in the worker (service role).
 * Every query is ALSO filtered by the project id passed in.
 *
 * DB rules this code relies on (never re-implemented here):
 * - rights belong to ASSETS (sources, videos); the asset's rights_status,
 *   rights_check_id and usable_in_production are derived from its LATEST check
 * - GREEN needs a documented basis (rights_checks_green_requires_basis)
 * - YELLOW is usable only after record_approval('rights', latest check) by a
 *   person, and never by automated writers; RED can never be approved
 * - checked_by / checked_at are stamped by the DB from the session
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
function mustOne<T>(res: { data: T; error: ServiceError | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new QueryFailed(res.error ?? { message: "no row returned" });
  return res.data as NonNullable<T>;
}
function mustCount(res: { count: number | null; error: ServiceError | null }): number {
  if (res.error) throw new QueryFailed(res.error);
  return res.count ?? 0;
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

const uniq = <T>(list: readonly (T | null | undefined)[]): T[] => [...new Set(list.filter((v): v is T => v !== null && v !== undefined))];
const personName = (p: { display_name: string | null; email: string } | null | undefined) => p?.display_name || p?.email || null;

/* ------------------------------------------------------------------------- */
/* read model: public.asset_rights (every asset + its latest classification) */
/* ------------------------------------------------------------------------- */

type AssetRightsRow = Database["public"]["Views"]["asset_rights"]["Row"];

const ASSET_COLUMNS =
  "asset_type, asset_id, title, publisher, url, kind, license_status, rights_status, usable_in_production, awaiting_approval, check_id, owner, ownership, source_detail, license, commercial_use, authorization_details, transformation_required, risk, evidence_url, notes, checked_at, checked_by_agent, expires_at, created_at";

export type AssetListItem = {
  assetType: AssetType;
  assetId: string;
  title: string;
  publisher: string | null;
  url: string | null;
  /** source_type for sources, the container for uploaded videos */
  kind: string | null;
  licenseStatus: Enums<"license_status"> | null;
  rightsStatus: AssetRightsStatus;
  usable: boolean;
  awaitingApproval: boolean;
  /** latest classification (null = never classified) */
  checkId: string | null;
  owner: string | null;
  ownership: Ownership | null;
  sourceDetail: string | null;
  license: string | null;
  commercialUse: boolean | null;
  authorization: string | null;
  transformationRequired: boolean | null;
  risk: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  checkedAt: string | null;
  checkedByAgent: Enums<"agent_key"> | null;
  expiresAt: string | null;
  createdAt: string | null;
};

/** the columns selected by ASSET_COLUMNS */
type AssetRow = Omit<AssetRightsRow, "checked_by" | "project_id">;

function toAssetItem(r: AssetRow): AssetListItem {
  return {
    assetType: r.asset_type === "video" ? "video" : "source",
    assetId: r.asset_id ?? "",
    title: r.title || r.publisher || r.url || "Untitled asset",
    publisher: r.publisher,
    url: r.url,
    kind: r.kind,
    licenseStatus: r.license_status,
    rightsStatus: r.rights_status ?? "unchecked",
    usable: r.usable_in_production === true,
    awaitingApproval: r.awaiting_approval === true,
    checkId: r.check_id,
    owner: r.owner,
    ownership: r.ownership,
    sourceDetail: r.source_detail,
    license: r.license,
    commercialUse: r.commercial_use,
    authorization: r.authorization_details,
    transformationRequired: r.transformation_required,
    risk: r.risk,
    evidenceUrl: r.evidence_url,
    notes: r.notes,
    checkedAt: r.checked_at,
    checkedByAgent: r.checked_by_agent,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

/** Assets awaiting a YELLOW approval first, then newest. */
export async function listAssets(
  db: Db,
  projectId: string,
  filters: RightsFilters = {},
  limit = 200,
): Promise<ServiceResult<{ items: AssetListItem[]; total: number }>> {
  return guarded("rights.list_failed", async () => {
    let q = db.from("asset_rights").select(ASSET_COLUMNS, { count: "exact" }).eq("project_id", projectId);
    if (filters.status) q = q.eq("rights_status", filters.status);
    if (filters.type) {
      const t = TYPE_FILTERS.find((x) => x.value === filters.type)!;
      q = q.eq("asset_type", t.assetType);
      if (t.kinds) q = q.in("kind", [...t.kinds]);
    }
    if (filters.awaitingApproval) q = q.eq("awaiting_approval", true);
    if (filters.search) q = q.or(orIlikeFilter(["title", "publisher", "url"], filters.search));
    const res = await q
      .order("awaiting_approval", { ascending: false })
      .order("created_at", { ascending: false })
      .order("asset_id")
      .limit(limit);
    const rows = must(res) ?? [];
    return success({ items: rows.map(toAssetItem), total: res.count ?? rows.length });
  });
}

export type RightsSummary = {
  total: number;
  green: number;
  yellow: number;
  red: number;
  unchecked: number;
  /** YELLOW whose latest classification has no (or a rejected) usage approval */
  awaitingApproval: number;
  usable: number;
  /** unchecked uploads, video links, social posts and images (what would appear on screen) */
  uncheckedMedia: number;
};

export async function rightsSummary(db: Db, projectId: string): Promise<ServiceResult<RightsSummary>> {
  return guarded("rights.summary_failed", async () => {
    const base = () => db.from("asset_rights").select("asset_id", { count: "exact", head: true }).eq("project_id", projectId);
    const [total, green, yellow, red, unchecked, awaiting, usable, uncheckedMedia] = await Promise.all([
      base(),
      base().eq("rights_status", "green"),
      base().eq("rights_status", "yellow"),
      base().eq("rights_status", "red"),
      base().eq("rights_status", "unchecked"),
      base().eq("awaiting_approval", true),
      base().eq("usable_in_production", true),
      base().eq("rights_status", "unchecked").or("asset_type.eq.video,kind.in.(video,social,other)"),
    ]);
    return success({
      total: mustCount(total),
      green: mustCount(green),
      yellow: mustCount(yellow),
      red: mustCount(red),
      unchecked: mustCount(unchecked),
      awaitingApproval: mustCount(awaiting),
      usable: mustCount(usable),
      uncheckedMedia: mustCount(uncheckedMedia),
    });
  });
}

/* ------------------------------------------------------------------------- */
/* asset detail: current classification, history, approvals, usage           */
/* ------------------------------------------------------------------------- */

export type RightsApprovalView = {
  id: string;
  decision: Enums<"approval_decision">;
  notes: string | null;
  createdAt: string;
  decidedBy: string | null;
};

export type RightsCheckView = {
  id: string;
  status: ClassifiedStatus;
  ownership: Ownership;
  owner: string | null;
  sourceDetail: string | null;
  license: string | null;
  commercialUse: boolean | null;
  authorization: string | null;
  transformationRequired: boolean;
  risk: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  checkedAt: string;
  checkedBy: string | null;
  checkedByAgent: Enums<"agent_key"> | null;
  expiresAt: string | null;
  /** the classification that currently decides the asset's rights */
  isLatest: boolean;
  /** usage decisions on this check, newest first (YELLOW only) */
  approvals: RightsApprovalView[];
};

export type SourceDetails = {
  type: "source";
  sourceType: Enums<"source_type">;
  licenseStatus: Enums<"license_status">;
  summary: string | null;
  author: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  /** register-form kind (e.g. image), when registered in the Rights Center */
  assetKind: string | null;
  fromConnector: boolean;
};

export type VideoDetails = {
  type: "video";
  originalFilename: string | null;
  container: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  status: Enums<"video_status">;
  /** the external link this upload came from, if recorded */
  source: { id: string; title: string } | null;
};

export type AssetUsage = {
  /** opportunities whose research uses this source */
  opportunities: { id: string; title: string; status: Enums<"opportunity_status">; itemTypes: Enums<"research_item_type">[] }[];
  /** claims citing this source as evidence */
  claims: number;
  /** content items whose clips cut this video */
  contentItems: { id: string; title: string; stage: Enums<"content_stage">; clips: number }[];
  /** clips of this video not attached to a content item yet */
  unassignedClips: number;
  /** uploads that came from this source link */
  videos: { id: string; title: string }[];
};

export type AssetDetail = {
  asset: AssetListItem;
  details: SourceDetails | VideoDetails;
  checks: RightsCheckView[];
  latest: RightsCheckView | null;
  /** latest check is YELLOW: a person may approve/reject its use */
  approvable: boolean;
  usage: AssetUsage;
};

const CHECK_COLUMNS =
  "id, status, ownership, owner, source_detail, license, commercial_use, authorization_details, transformation_required, risk, evidence_url, notes, checked_at, checked_by_agent, expires_at, created_at, checker:users!rights_checks_checked_by_fkey(display_name, email)";

export async function getAsset(db: Db, projectId: string, assetType: AssetType, assetId: string): Promise<ServiceResult<AssetDetail>> {
  return guarded("rights.asset_failed", async () => {
    const row = must(
      await db.from("asset_rights").select(ASSET_COLUMNS).eq("project_id", projectId).eq("asset_type", assetType).eq("asset_id", assetId).maybeSingle(),
    );
    if (!row) return notFound("asset");
    const asset = toAssetItem(row);

    const [details, checkRows, usage] = await Promise.all([
      loadDetails(db, projectId, assetType, assetId),
      db
        .from("rights_checks")
        .select(CHECK_COLUMNS)
        .eq("project_id", projectId)
        .eq(assetType === "video" ? "video_id" : "source_id", assetId)
        // same order the DB uses to pick the latest check
        .order("checked_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      loadUsage(db, projectId, assetType, assetId),
    ]);
    if (!details) return notFound("asset");
    const rows = must(checkRows) ?? [];

    const checkIds = rows.map((c) => c.id);
    const approvalRows = checkIds.length
      ? (must(
          await db
            .from("approvals")
            .select("id, entity_id, decision, notes, created_at, decider:users!approvals_decided_by_fkey(display_name, email)")
            .eq("project_id", projectId)
            .eq("checkpoint", "rights")
            .eq("entity_type", "rights_check")
            .in("entity_id", checkIds)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false }),
        ) ?? [])
      : [];

    const checks: RightsCheckView[] = rows.map((c) => ({
      id: c.id,
      status: c.status === "unchecked" ? "yellow" : c.status, // DB check: a classification is never 'unchecked'
      ownership: c.ownership,
      owner: c.owner,
      sourceDetail: c.source_detail,
      license: c.license,
      commercialUse: c.commercial_use,
      authorization: c.authorization_details,
      transformationRequired: c.transformation_required,
      risk: c.risk,
      evidenceUrl: c.evidence_url,
      notes: c.notes,
      checkedAt: c.checked_at,
      checkedBy: personName(c.checker),
      checkedByAgent: c.checked_by_agent,
      expiresAt: c.expires_at,
      isLatest: c.id === asset.checkId,
      approvals: approvalRows
        .filter((a) => a.entity_id === c.id)
        .map((a) => ({ id: a.id, decision: a.decision, notes: a.notes, createdAt: a.created_at, decidedBy: personName(a.decider) })),
    }));
    const latest = checks.find((c) => c.isLatest) ?? null;

    return success({ asset, details, checks, latest, approvable: latest?.status === "yellow", usage });
  });
}

async function loadDetails(db: Db, projectId: string, assetType: AssetType, assetId: string): Promise<SourceDetails | VideoDetails | null> {
  if (assetType === "source") {
    const s = must(
      await db
        .from("sources")
        .select("source_type, license_status, summary, author, published_at, retrieved_at, metadata, connector_id")
        .eq("id", assetId)
        .eq("project_id", projectId)
        .maybeSingle(),
    );
    if (!s) return null;
    const meta = (s.metadata ?? {}) as { asset_kind?: unknown };
    return {
      type: "source",
      sourceType: s.source_type,
      licenseStatus: s.license_status,
      summary: s.summary,
      author: s.author,
      publishedAt: s.published_at,
      retrievedAt: s.retrieved_at,
      assetKind: typeof meta.asset_kind === "string" ? meta.asset_kind : null,
      fromConnector: s.connector_id !== null,
    };
  }
  const v = must(
    await db
      .from("videos")
      .select("original_filename, container, duration_sec, size_bytes, status, source_id")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .maybeSingle(),
  );
  if (!v) return null;
  const source = v.source_id
    ? must(await db.from("sources").select("id, title, name").eq("id", v.source_id).eq("project_id", projectId).maybeSingle())
    : null;
  return {
    type: "video",
    originalFilename: v.original_filename,
    container: v.container,
    durationSec: v.duration_sec,
    sizeBytes: v.size_bytes,
    status: v.status,
    source: source ? { id: source.id, title: source.title || source.name } : null,
  };
}

async function loadUsage(db: Db, projectId: string, assetType: AssetType, assetId: string): Promise<AssetUsage> {
  const usage: AssetUsage = { opportunities: [], claims: 0, contentItems: [], unassignedClips: 0, videos: [] };

  if (assetType === "source") {
    const [items, claims, videos] = await Promise.all([
      db.from("research_items").select("opportunity_id, item_type").eq("project_id", projectId).eq("source_id", assetId),
      db.from("fact_sources").select("fact_id", { count: "exact", head: true }).eq("project_id", projectId).eq("source_id", assetId),
      db.from("videos").select("id, title").eq("project_id", projectId).eq("source_id", assetId).order("created_at", { ascending: false }),
    ]);
    const itemRows = must(items) ?? [];
    usage.claims = mustCount(claims);
    usage.videos = must(videos) ?? [];
    const oppIds = uniq(itemRows.map((i) => i.opportunity_id));
    if (oppIds.length) {
      const opps = must(await db.from("opportunities").select("id, title, status").eq("project_id", projectId).in("id", oppIds).order("created_at", { ascending: false })) ?? [];
      usage.opportunities = opps.map((o) => ({
        ...o,
        itemTypes: uniq(itemRows.filter((i) => i.opportunity_id === o.id).map((i) => i.item_type)),
      }));
    }
    return usage;
  }

  const clips = must(await db.from("clips").select("content_item_id").eq("project_id", projectId).eq("video_id", assetId)) ?? [];
  usage.unassignedClips = clips.filter((c) => !c.content_item_id).length;
  const itemIds = uniq(clips.map((c) => c.content_item_id));
  if (itemIds.length) {
    const items = must(await db.from("content_items").select("id, title, stage").eq("project_id", projectId).in("id", itemIds).order("created_at", { ascending: false })) ?? [];
    usage.contentItems = items.map((i) => ({ ...i, clips: clips.filter((c) => c.content_item_id === i.id).length }));
  }
  return usage;
}

/* ------------------------------------------------------------------------- */
/* writes                                                                    */
/* ------------------------------------------------------------------------- */

const GREEN_BASIS_MESSAGE =
  "GREEN needs confirmed commercial use, a documented ownership basis and an evidence link (unless the asset is owned or public domain). Record YELLOW until it is on file.";

/**
 * Record a classification (a new rights_checks row: history is append-only in
 * practice). The DB derives the asset's status/usability from it. `agent` is
 * for automated callers (service role): they may only suggest YELLOW or RED —
 * a GREEN, which lets automated production use the asset, is a human call.
 */
export async function classify(
  db: Db,
  args: { projectId: string; assetType: AssetType; assetId: string; fields: ClassificationFields; agent?: Enums<"agent_key"> },
): Promise<ServiceResult<{ checkId: string; status: ClassifiedStatus; rightsStatus: AssetRightsStatus; usable: boolean }>> {
  return guarded("rights.classify_failed", async () => {
    const { projectId, assetType, assetId, fields } = args;
    if (args.agent && fields.status === "green") {
      return failure({ code: "AGENT_GREEN", userMessage: "Only a person can classify an asset GREEN. Agents may suggest YELLOW or RED." });
    }
    const table = assetType === "video" ? "videos" : "sources";
    const exists = must(await db.from(table).select("id").eq("id", assetId).eq("project_id", projectId).maybeSingle());
    if (!exists) return notFound("asset");

    const { data, error } = await db
      .from("rights_checks")
      .insert({
        project_id: projectId,
        source_id: assetType === "source" ? assetId : null,
        video_id: assetType === "video" ? assetId : null,
        status: fields.status,
        ownership: fields.ownership,
        owner: fields.owner,
        source_detail: fields.sourceDetail,
        license: fields.license,
        commercial_use: fields.commercialUse,
        authorization_details: fields.authorization,
        transformation_required: fields.transformationRequired,
        risk: fields.risk,
        evidence_url: fields.evidenceUrl,
        notes: fields.notes,
        checked_by_agent: args.agent ?? null, // the DB replaces it with the signed-in person when there is one
      })
      .select("id, status")
      .single();
    if (error) {
      if (error.code === "23514" && /rights_checks_green_requires_basis/.test(error.message ?? "")) {
        logger.warn("rights.classify_green_refused", { projectId, assetType, assetId });
        return failure({ ...error, userMessage: GREEN_BASIS_MESSAGE });
      }
      throw new QueryFailed(error);
    }

    const state = mustOne(await db.from(table).select("rights_status, usable_in_production").eq("id", assetId).eq("project_id", projectId).single());
    return success({
      checkId: data.id,
      status: data.status === "unchecked" ? "yellow" : data.status,
      rightsStatus: state.rights_status,
      usable: state.usable_in_production,
    });
  });
}

/**
 * Register an external asset (video link, social post, image, official
 * material) as a source of the project. The same link (canonical URL) is
 * reused, never duplicated — including links that came from connectors.
 */
export async function registerAsset(
  db: Db,
  args: { projectId: string; input: RegisterAssetInput },
): Promise<ServiceResult<{ sourceId: string; existing: boolean }>> {
  return guarded<{ sourceId: string; existing: boolean }>("rights.register_failed", async () => {
    const { projectId, input } = args;
    const canonical = canonicalizeUrl(input.url);
    if (!canonical) return failure({ code: "22023", message: "invalid url", userMessage: "Paste a full http(s) link." });
    const raw = input.url.trim();

    const find = async () => {
      for (const url of uniq([canonical, raw])) {
        const hit = must(await db.from("sources").select("id").eq("project_id", projectId).eq("url", url).limit(1).maybeSingle());
        if (hit) return hit.id;
      }
      return null;
    };

    const found = await find();
    if (found) return success({ sourceId: found, existing: true });

    const { data, error } = await db
      .from("sources")
      .insert({
        project_id: projectId,
        name: publisherFromUrl(canonical, input.publisher),
        title: input.title,
        url: canonical,
        source_type: kindToSourceType(input.kind),
        metadata: { added_from: "rights_center", asset_kind: input.kind },
      })
      .select("id")
      .single();
    if (error) {
      // registered concurrently (unique project_id + url): reuse it
      if (error.code === "23505") {
        const again = await find();
        if (again) return success({ sourceId: again, existing: true });
      }
      throw new QueryFailed(error);
    }
    return success({ sourceId: data.id, existing: false });
  });
}

/**
 * RIGHTS → APPROVAL (YELLOW only) through public.record_approval: the decision
 * is recorded by the signed-in person and the asset's usability is derived from
 * it atomically. The DB refuses non-YELLOW checks, stale checks and automated callers.
 */
export async function decideRights(
  db: Db,
  args: { projectId: string; checkId: string; decision: Enums<"approval_decision">; notes: string | null },
): Promise<ServiceResult<{ approvalId: string; assetType: AssetType; assetId: string; usable: boolean }>> {
  return guarded("rights.decision_failed", async () => {
    const { projectId, checkId } = args;
    const check = must(await db.from("rights_checks").select("id, status, source_id, video_id").eq("id", checkId).eq("project_id", projectId).maybeSingle());
    if (!check) return notFound("classification");
    const assetType: AssetType = check.video_id ? "video" : "source";
    const assetId = (check.video_id ?? check.source_id)!;
    const table = assetType === "video" ? "videos" : "sources";

    if (check.status !== "yellow") {
      return failure({
        code: "RIGHTS_APPROVAL_INVALID",
        userMessage:
          check.status === "red"
            ? "RED assets never enter production and cannot be approved. Re-classify the asset if new documentation exists."
            : "GREEN assets are usable as classified: only YELLOW needs a usage approval.",
      });
    }
    const current = mustOne(await db.from(table).select("rights_check_id").eq("id", assetId).eq("project_id", projectId).single());
    if (current.rights_check_id !== checkId) {
      return failure({ code: "RIGHTS_APPROVAL_INVALID", userMessage: "A newer classification exists for this asset: decide on the latest one." });
    }

    const approval = mustOne(
      await db.rpc("record_approval", {
        p_checkpoint: "rights",
        p_entity_id: checkId,
        p_decision: args.decision,
        ...(args.notes ? { p_notes: args.notes } : {}),
      }),
    );
    const state = mustOne(await db.from(table).select("usable_in_production").eq("id", assetId).eq("project_id", projectId).single());
    return success({ approvalId: approval.id, assetType, assetId, usable: state.usable_in_production });
  });
}

/** STORY ≠ FOOTAGE: the production plan chosen for a story (stories.production_formats). */
export async function setProductionFormats(
  db: Db,
  args: { projectId: string; storyId: string; formats: EditorialFormat[] },
): Promise<ServiceResult<{ formats: EditorialFormat[] }>> {
  return guarded("rights.production_formats_failed", async () => {
    const row = must(
      await db
        .from("stories")
        .update({ production_formats: args.formats })
        .eq("id", args.storyId)
        .eq("project_id", args.projectId)
        .select("production_formats")
        .maybeSingle(),
    );
    if (!row) return notFound("story");
    return success({ formats: row.production_formats });
  });
}

/* ------------------------------------------------------------------------- */
/* STORY ≠ FOOTAGE: what a story can be produced with                        */
/* ------------------------------------------------------------------------- */

export type StoryAsset = {
  assetType: AssetType;
  assetId: string;
  title: string;
  status: AssetRightsStatus;
  usable: boolean;
  ownership: Ownership | null;
  kind: string | null;
  /** how the asset is attached to the story */
  via: "clip" | "research";
};

export type StoryAlternativesData = {
  story: Pick<Tables<"stories">, "id" | "title" | "status"> & { productionFormats: EditorialFormat[] };
  opportunity: { id: string; title: string } | null;
  /** footage candidates: videos cut into the story's clips + media sources of its research */
  assets: StoryAsset[];
  material: StoryMaterial;
  /** news articles in the research: references for facts, not footage */
  referenceArticles: number;
};

const FOOTAGE_ITEM_TYPES: Enums<"research_item_type">[] = ["video", "media"];
const FOOTAGE_SOURCE_KINDS = new Set(["video", "social"]);

/**
 * Everything the editorial-alternatives panel needs for one story.
 * Assets: videos used by clips of the story's content items, and sources linked
 * through research items (video / media / article) of its opportunity. Like the
 * opportunity's Rights Safety estimate, an 'article' item counts as footage only
 * when its source is a video/social link; news articles are references.
 */
export async function loadStoryAlternatives(db: Db, projectId: string, storyId: string): Promise<ServiceResult<StoryAlternativesData>> {
  return guarded("rights.story_alternatives_failed", async () => {
    const story = must(
      await db.from("stories").select("id, title, status, production_formats, opportunity_id").eq("id", storyId).eq("project_id", projectId).maybeSingle(),
    );
    if (!story) return notFound("story");
    const oppId = story.opportunity_id;

    const [opp, contentItems, items, facts] = await Promise.all([
      oppId
        ? db.from("opportunities").select("id, title, event_id").eq("id", oppId).eq("project_id", projectId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("content_items").select("id").eq("story_id", storyId).eq("project_id", projectId),
      oppId
        ? db.from("research_items").select("item_type, source_id, title, content").eq("opportunity_id", oppId).eq("project_id", projectId)
        : Promise.resolve({ data: [], error: null }),
      db
        .from("facts")
        .select("claim")
        .eq("project_id", projectId)
        .eq("status", "confirmed")
        .or(oppId ? `story_id.eq.${storyId},opportunity_id.eq.${oppId}` : `story_id.eq.${storyId}`),
    ]);
    const opportunity = must(opp);
    const itemRows = must(items) ?? [];
    const claims = (must(facts) ?? []).map((f) => f.claim);

    // videos cut into the story's clips (rejected clips don't use the footage)
    const itemIds = (must(contentItems) ?? []).map((c) => c.id);
    const clips = itemIds.length
      ? (must(await db.from("clips").select("video_id").eq("project_id", projectId).in("content_item_id", itemIds).neq("status", "rejected")) ?? [])
      : [];
    const videoIds = uniq(clips.map((c) => c.video_id));

    // sources gathered in research as video / media / article
    const linked = itemRows.filter((i) => i.source_id && (FOOTAGE_ITEM_TYPES.includes(i.item_type) || i.item_type === "article"));
    const sourceIds = uniq(linked.map((i) => i.source_id));
    const mediaItemSources = new Set(linked.filter((i) => FOOTAGE_ITEM_TYPES.includes(i.item_type)).map((i) => i.source_id as string));

    const [videoRows, sourceRows, event] = await Promise.all([
      videoIds.length
        ? db.from("asset_rights").select(ASSET_COLUMNS).eq("project_id", projectId).eq("asset_type", "video").in("asset_id", videoIds)
        : Promise.resolve({ data: [], error: null }),
      sourceIds.length
        ? db.from("asset_rights").select(ASSET_COLUMNS).eq("project_id", projectId).eq("asset_type", "source").in("asset_id", sourceIds)
        : Promise.resolve({ data: [], error: null }),
      opportunity?.event_id
        ? db.from("events").select("venue").eq("id", opportunity.event_id).eq("project_id", projectId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const toStoryAsset = (a: AssetListItem, via: StoryAsset["via"]): StoryAsset => ({
      assetType: a.assetType,
      assetId: a.assetId,
      title: a.title,
      status: a.rightsStatus,
      usable: a.usable,
      ownership: a.ownership,
      kind: a.kind,
      via,
    });
    const assets: StoryAsset[] = (must(videoRows) ?? []).map((r) => toStoryAsset(toAssetItem(r), "clip"));
    let referenceArticles = 0;
    for (const r of must(sourceRows) ?? []) {
      const a = toAssetItem(r);
      if (mediaItemSources.has(a.assetId) || FOOTAGE_SOURCE_KINDS.has(a.kind ?? "")) assets.push(toStoryAsset(a, "research"));
      else referenceArticles += 1;
    }

    const venue = must(event)?.venue?.trim();
    const material: StoryMaterial = {
      assets: assets.map((a) => ({ status: a.status, usable: a.usable, ownership: a.ownership, kind: a.kind })),
      confirmedFacts: claims.length,
      timelineItems: itemRows.filter((i) => i.item_type === "timeline").length,
      quotes: itemRows.filter((i) => i.item_type === "quote").length,
      hasStatistics: hasNumericStatistic(claims),
      hasLocations:
        Boolean(venue) ||
        hasLocationMention([
          ...claims,
          ...itemRows.filter((i) => i.item_type === "timeline" || i.item_type === "context").flatMap((i) => [i.title, i.content]),
        ]),
    };

    const known = new Set<string>(EDITORIAL_FORMATS.map((f) => f.value));
    return success({
      story: {
        id: story.id,
        title: story.title,
        status: story.status,
        productionFormats: (story.production_formats ?? []).filter((f): f is EditorialFormat => known.has(f)),
      },
      opportunity: opportunity ? { id: opportunity.id, title: opportunity.title } : null,
      assets,
      material,
      referenceArticles,
    });
  });
}
