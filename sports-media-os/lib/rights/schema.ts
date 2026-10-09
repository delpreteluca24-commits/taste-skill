import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import { EDITORIAL_FORMATS, type EditorialFormat } from "@/lib/rights/alternatives";
import { greenBasisMissing, OWNERSHIP_OPTIONS, type Ownership, type RightsFacts } from "@/lib/rights/classify";

/**
 * Rights Center input validation and mapping helpers. Pure (no I/O, no Node
 * built-ins): shared by server actions, pages and the live classification form.
 *
 * The GREEN rule is mirrored from the DB check rights_checks_green_requires_basis
 * (via greenBasisMissing) only to give friendly field errors — the database
 * stays the authority.
 */

export const RIGHTS_STATUSES = ["green", "yellow", "red"] as const;
export type ClassifiedStatus = (typeof RIGHTS_STATUSES)[number];
export type AssetRightsStatus = Enums<"rights_status">;

export const ASSET_TYPES = ["source", "video"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(v: unknown): v is AssetType {
  return typeof v === "string" && (ASSET_TYPES as readonly string[]).includes(v);
}

export const OWNERSHIP_VALUES = OWNERSHIP_OPTIONS.map((o) => o.value) as [Ownership, ...Ownership[]];

export function ownershipLabel(o: string | null | undefined): string {
  if (!o) return "—";
  return OWNERSHIP_OPTIONS.find((x) => x.value === o)?.label ?? o;
}

/* ------------------------------------------------------------------------- */
/* field helpers                                                             */
/* ------------------------------------------------------------------------- */

/** "" / missing → null, otherwise trimmed and length-checked */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

/** true when the string is an absolute http(s) URL */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const optionalHttpUrl = z
  .string()
  .trim()
  .max(2048, "Links are limited to 2048 characters")
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isHttpUrl(v), "Paste a full http(s) link");

/** HTML checkbox ("on") / boolean → boolean */
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

/* ------------------------------------------------------------------------- */
/* commercial use: tri-state (null = unknown)                                */
/* ------------------------------------------------------------------------- */

export const COMMERCIAL_USE_OPTIONS = [
  { value: "yes", label: "Allowed" },
  { value: "no", label: "Not allowed" },
  { value: "unknown", label: "Unknown" },
] as const;
export type CommercialUseValue = (typeof COMMERCIAL_USE_OPTIONS)[number]["value"];

export function parseCommercialUse(v: string | null | undefined): boolean | null {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

export function commercialUseValue(b: boolean | null | undefined): CommercialUseValue {
  if (b === true) return "yes";
  if (b === false) return "no";
  return "unknown";
}

export function commercialUseLabel(b: boolean | null | undefined): string {
  return COMMERCIAL_USE_OPTIONS.find((o) => o.value === commercialUseValue(b))!.label;
}

/* ------------------------------------------------------------------------- */
/* classification form (all ten rights-first fields)                         */
/* ------------------------------------------------------------------------- */

export type GreenBasisField = "commercialUse" | "ownership" | "evidenceUrl" | "status";

/**
 * Field of the classification form each greenBasisMissing() message refers to.
 * Unknown messages land on the status field (never dropped).
 */
export function greenBasisField(message: string): GreenBasisField {
  if (/commercial/i.test(message)) return "commercialUse";
  if (/ownership/i.test(message)) return "ownership";
  if (/evidence/i.test(message)) return "evidenceUrl";
  return "status";
}

/** Friendly per-field errors for a GREEN without a documented basis ({} when GREEN is allowed). */
export function greenBasisFieldErrors(facts: Pick<RightsFacts, "ownership" | "commercialUse" | "evidenceUrl">): Partial<Record<GreenBasisField, string>> {
  const out: Partial<Record<GreenBasisField, string>> = {};
  for (const message of greenBasisMissing(facts)) {
    const field = greenBasisField(message);
    out[field] ??= `For GREEN, ${message}.`;
  }
  return out;
}

export const classificationSchema = z
  .object({
    assetType: z.enum(ASSET_TYPES, { error: "Unknown asset type" }),
    assetId: z.uuid({ error: "Invalid asset" }),
    status: z.enum(RIGHTS_STATUSES, { error: "Pick GREEN, YELLOW or RED" }),
    ownership: z.enum(OWNERSHIP_VALUES, { error: "Pick who holds the rights" }),
    owner: optionalText(200),
    sourceDetail: optionalText(500),
    license: optionalText(1000),
    commercialUse: z
      .enum(["yes", "no", "unknown"], { error: "Pick allowed, not allowed or unknown" })
      .optional()
      .transform((v) => parseCommercialUse(v)),
    authorization: optionalText(2000),
    transformationRequired: checkbox,
    risk: optionalText(500),
    evidenceUrl: optionalHttpUrl,
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.status !== "green") return;
    const errors = greenBasisFieldErrors({ ownership: v.ownership, commercialUse: v.commercialUse, evidenceUrl: v.evidenceUrl });
    const fields = Object.keys(errors) as GreenBasisField[];
    if (fields.length === 0) return;
    for (const field of fields) ctx.addIssue({ code: "custom", path: [field], message: errors[field]! });
    if (!errors.status) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "GREEN needs a documented basis (see the highlighted fields). Record YELLOW until it is on file.",
      });
    }
  });
export type ClassificationInput = z.infer<typeof classificationSchema>;
/** the classification without the asset reference (what is stored on the check) */
export type ClassificationFields = Omit<ClassificationInput, "assetType" | "assetId">;

/** suggestRightsStatus() input from the form fields (+ the source's license status) */
export function factsFromFields(
  f: Pick<ClassificationFields, "ownership" | "commercialUse" | "evidenceUrl" | "authorization" | "license" | "transformationRequired" | "risk">,
  licenseStatus?: string | null,
): RightsFacts {
  return {
    ownership: f.ownership,
    commercialUse: f.commercialUse,
    evidenceUrl: f.evidenceUrl,
    authorization: f.authorization,
    license: f.license,
    transformationRequired: f.transformationRequired,
    knownRisk: f.risk,
    licenseStatus: licenseStatus ?? null,
  };
}

/* ------------------------------------------------------------------------- */
/* register an external asset (→ sources)                                    */
/* ------------------------------------------------------------------------- */

export const ASSET_KINDS = [
  { value: "video", label: "Video link", sourceType: "video" },
  { value: "social", label: "Social post", sourceType: "social" },
  { value: "image", label: "Image / photo", sourceType: "other" },
  { value: "official", label: "Official material (club, league, athlete)", sourceType: "official" },
  { value: "other", label: "Other", sourceType: "other" },
] as const satisfies readonly { value: string; label: string; sourceType: Enums<"source_type"> }[];
export type AssetKind = (typeof ASSET_KINDS)[number]["value"];
const ASSET_KIND_VALUES = ASSET_KINDS.map((k) => k.value) as [AssetKind, ...AssetKind[]];

/** register-form kind → sources.source_type (image has no source type of its own: 'other' + metadata.asset_kind) */
export function kindToSourceType(kind: AssetKind): Enums<"source_type"> {
  return ASSET_KINDS.find((k) => k.value === kind)!.sourceType;
}

export const registerAssetSchema = z.object({
  url: z
    .string({ error: "Paste the asset's link" })
    .trim()
    .min(1, "Paste the asset's link")
    .max(2048, "Links are limited to 2048 characters")
    .refine(isHttpUrl, "Paste a full http(s) link"),
  title: optionalText(300),
  publisher: optionalText(200),
  kind: z.enum(ASSET_KIND_VALUES, { error: "Pick what kind of asset this is" }),
});
export type RegisterAssetInput = z.infer<typeof registerAssetSchema>;

/** Publisher name for a source: the given one, else the link's host without www. */
export function publisherFromUrl(url: string, publisher?: string | null): string {
  const given = publisher?.trim();
  if (given) return given.slice(0, 200);
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 200) || "Unknown publisher";
  } catch {
    return "Unknown publisher";
  }
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  video: "Video link",
  social: "Social post",
  official: "Official",
  press_release: "Press release",
  news: "Article",
  rss: "Article (feed)",
  api: "API item",
  other: "Other / image",
};

/** Human label for an asset's kind (asset_rights.kind is source_type for sources, the container for videos). */
export function assetKindLabel(assetType: AssetType, kind: string | null | undefined): string {
  if (assetType === "video") return kind && kind !== "video" ? `Uploaded video (${kind})` : "Uploaded video";
  return (kind && SOURCE_KIND_LABELS[kind]) ?? "Link";
}

/* ------------------------------------------------------------------------- */
/* YELLOW usage approval                                                     */
/* ------------------------------------------------------------------------- */

export const rightsDecisionSchema = z
  .object({
    checkId: z.uuid({ error: "Invalid classification" }),
    decision: z.enum(["approved", "rejected"], { error: "Approve or reject" }),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    // whoever clears a YELLOW asset takes responsibility: say who confirmed what, and where the proof is
    if (v.decision === "approved" && (v.notes ?? "").length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Explain the approval: who confirmed the rights, the scope, and where the proof is kept.",
      });
    }
  });
export type RightsDecisionInput = z.infer<typeof rightsDecisionSchema>;

/* ------------------------------------------------------------------------- */
/* STORY ≠ FOOTAGE: chosen production formats                                */
/* ------------------------------------------------------------------------- */

const EDITORIAL_FORMAT_VALUES = EDITORIAL_FORMATS.map((f) => f.value) as [EditorialFormat, ...EditorialFormat[]];

export const productionFormatsSchema = z.object({
  storyId: z.uuid({ error: "Invalid story" }),
  formats: z
    .array(z.enum(EDITORIAL_FORMAT_VALUES, { error: "Unknown production format" }))
    .max(EDITORIAL_FORMAT_VALUES.length)
    .transform((list) => EDITORIAL_FORMAT_VALUES.filter((f) => list.includes(f))), // unique, catalogue order
});

/* ------------------------------------------------------------------------- */
/* list filters                                                              */
/* ------------------------------------------------------------------------- */

export const STATUS_FILTERS = ["green", "yellow", "red", "unchecked"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** "Type" filter: uploads vs. kinds of external links (several source types per group) */
export const TYPE_FILTERS = [
  { value: "upload", label: "Uploaded videos", assetType: "video", kinds: null },
  { value: "video", label: "Video links", assetType: "source", kinds: ["video"] },
  { value: "social", label: "Social posts", assetType: "source", kinds: ["social"] },
  { value: "official", label: "Official / press", assetType: "source", kinds: ["official", "press_release"] },
  { value: "article", label: "Articles", assetType: "source", kinds: ["news", "rss", "api"] },
  { value: "other", label: "Images / other", assetType: "source", kinds: ["other"] },
] as const satisfies readonly { value: string; label: string; assetType: AssetType; kinds: readonly Enums<"source_type">[] | null }[];
export type TypeFilter = (typeof TYPE_FILTERS)[number]["value"];

export type RightsFilters = {
  status?: StatusFilter;
  type?: TypeFilter;
  awaitingApproval?: boolean;
  search?: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** URL search params → filters. Invalid values are dropped, never trusted. */
export function parseRightsFilters(sp: SearchParams): RightsFilters {
  const f: RightsFilters = {};
  const status = first(sp.status);
  if (status && (STATUS_FILTERS as readonly string[]).includes(status)) f.status = status as StatusFilter;
  const type = first(sp.type);
  if (type && TYPE_FILTERS.some((t) => t.value === type)) f.type = type as TypeFilter;
  if (first(sp.awaiting) === "1") f.awaitingApproval = true;
  const q = first(sp.q);
  if (q) f.search = q.slice(0, 100);
  return f;
}

export function hasRightsFilters(f: RightsFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}

/** escape LIKE wildcards so a search for "50%" is literal */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * PostgREST `or=(…)` filter: case-insensitive "contains" on several columns.
 * Values are double-quoted (commas, dots and parentheses in a search term
 * cannot break the filter syntax); quotes and backslashes are escaped.
 */
export function orIlikeFilter(columns: readonly string[], term: string): string {
  const pattern = `%${escapeLike(term)}%`.replace(/[\\"]/g, (c) => `\\${c}`);
  return columns.map((c) => `${c}.ilike."${pattern}"`).join(",");
}

/* ------------------------------------------------------------------------- */
/* research material heuristics (editorial alternatives)                     */
/* ------------------------------------------------------------------------- */

/**
 * Do these confirmed claims carry a number worth charting? Years and calendar
 * dates alone don't count ("in 2024", "on 12/05"); scores, percentages,
 * distances, counts and fees do.
 */
const MONTH =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\b\\.?";
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
  /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/g, // 12/05, 12.05.2024 (not "3-0": scores count)
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}`, "gi"), // 5 May, 12th of March
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), // May 5, March 12th
  /\b(?:1[89]|20)\d{2}(?:\/\d{2})?\b/g, // years, seasons (2024/25)
];

export function hasNumericStatistic(claims: readonly string[]): boolean {
  return claims.some((claim) => /\d/.test(DATE_PATTERNS.reduce((text, re) => text.replace(re, " "), claim)));
}

const NOT_PLACES = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const VENUE_WORDS = /\b(?:stadium|stadio|estadio|stade|arena|circuit|velodrome|racecourse|ballpark|venue|centre court|center court)\b/i;

/**
 * Does the research mention places a map could show? Heuristic: venue words,
 * or "at/in <Proper Noun>" that is not a month or weekday ("won at Anfield",
 * "in Madrid"). A known event venue counts as well (checked by the caller).
 */
export function hasLocationMention(texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((t) => {
    if (!t) return false;
    if (VENUE_WORDS.test(t)) return true;
    for (const m of t.matchAll(/\b(?:at|in)\s+(?:the\s+)?(\p{Lu}[\p{L}'’-]{2,})/gu)) {
      if (!NOT_PLACES.has(m[1].toLowerCase())) return true;
    }
    return false;
  });
}
