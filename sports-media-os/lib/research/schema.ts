import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import { Constants, type Json } from "@/types/database";

/**
 * Research Workspace input validation (pure, shared by actions, services,
 * pages and the worker). One schema per research item type; each maps to the
 * generic research_items columns (title · content · url · occurred_at ·
 * source_id · metadata) through toItemColumns().
 *
 * Attribution rule (also enforced by the DB): quotes, media and competitor
 * items need a source or a link.
 */

export const RESEARCH_ITEM_TYPES = Constants.public.Enums.research_item_type;
export type ResearchItemType = Enums<"research_item_type">;
export const SOURCE_TYPES = Constants.public.Enums.source_type;
export type SourceType = Enums<"source_type">;
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  news: "News",
  rss: "RSS",
  api: "API",
  social: "Social",
  video: "Video",
  official: "Official",
  press_release: "Press release",
  other: "Other",
};
export const FACT_STATUSES = Constants.public.Enums.fact_status;
export type FactStatus = Enums<"fact_status">;
export const CLAIM_RELATIONS = Constants.public.Enums.claim_relation;
export type ClaimRelation = Enums<"claim_relation">;

export const MEDIA_KINDS = ["video", "image", "audio", "graphic", "social_post"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const COMPETITOR_PLATFORMS = ["youtube", "tiktok", "instagram", "other"] as const;
export type CompetitorPlatform = (typeof COMPETITOR_PLATFORMS)[number];

/** Media kind → source type of the asset record (rights are classified on sources). */
export const MEDIA_SOURCE_TYPE: Record<MediaKind, SourceType> = {
  video: "video",
  image: "other",
  audio: "other",
  graphic: "other",
  social_post: "social",
};

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

const requiredText = (max: number, message: string) =>
  z.string({ error: message }).trim().min(1, message).max(max, `Keep it under ${max} characters`);

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrl = z
  .string({ error: "Paste a full link (https://…)" })
  .trim()
  .min(1, "Paste a full link (https://…)")
  .max(2048, "Link is too long")
  .refine(isHttpUrl, "Paste a full link (https://…)");

const optionalUrl = z
  .union([z.literal(""), httpUrl])
  .nullish()
  .transform((v) => (v ? v : null));

const optionalUuid = z
  .union([z.uuid({ error: "Pick a source from the list" }), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));

/**
 * Dates from <input type="date"> ("2026-10-08") or "datetime-local"
 * ("2026-10-08T20:45") or full ISO → ISO timestamp. Date-only values are kept
 * at 00:00 UTC so the calendar day never shifts.
 */
export function parseDateInput(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    const t = Date.UTC(y, m - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
    return back.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  // datetime-local has no zone: read as UTC (the UI labels dates as UTC)
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const dateField = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, message)
    .transform((v, ctx) => {
      const iso = parseDateInput(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Use a valid date" });
        return z.NEVER;
      }
      return iso;
    });

const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const iso = parseDateInput(v);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: "Use a valid date" });
      return z.NEVER;
    }
    return iso;
  });

/* ------------------------------------------------------------------------- */
/* research items                                                            */
/* ------------------------------------------------------------------------- */

const articleSchema = z.object({
  type: z.literal("article"),
  title: requiredText(500, "Title is required"),
  url: httpUrl,
  sourceId: optionalUuid,
  content: optionalText(4000),
  publishedAt: optionalDate,
});

const videoSchema = articleSchema.extend({ type: z.literal("video") });

const mediaSchema = z.object({
  type: z.literal("media"),
  title: requiredText(500, "Describe the asset"),
  url: httpUrl,
  mediaKind: z.enum(MEDIA_KINDS, { error: "Pick the kind of media" }),
  sourceId: optionalUuid,
  content: optionalText(2000),
});

const quoteSchema = z
  .object({
    type: z.literal("quote"),
    speaker: requiredText(200, "Who said it?"),
    content: requiredText(2000, "Paste the exact quote"),
    sourceId: optionalUuid,
    url: optionalUrl,
    saidAt: optionalDate,
  })
  .refine((q) => q.sourceId || q.url, {
    message: "Attribute the quote: pick a source or paste the link where it was said",
    path: ["sourceId"],
  });

const timelineSchema = z.object({
  type: z.literal("timeline"),
  title: requiredText(500, "Describe what happened"),
  occurredAt: dateField("When did it happen?"),
  content: optionalText(2000),
  sourceId: optionalUuid,
});

const noteSchema = z.object({
  type: z.literal("note"),
  title: optionalText(200),
  content: requiredText(8000, "Write the note"),
});

const questionSchema = z
  .object({
    type: z.literal("question"),
    content: requiredText(1000, "Write the question"),
    answered: z.boolean().default(false),
    answer: optionalText(4000),
  })
  .refine((q) => !q.answered || q.answer, { message: "Write the answer before marking it answered", path: ["answer"] });

const contextSchema = z.object({
  type: z.literal("context"),
  title: optionalText(200),
  content: requiredText(4000, "Write the context"),
  sourceId: optionalUuid,
});

const competitorSchema = z.object({
  type: z.literal("competitor"),
  title: requiredText(500, "Title of their video or post"),
  url: httpUrl,
  channel: requiredText(200, "Which channel or account?"),
  platform: z.enum(COMPETITOR_PLATFORMS, { error: "Pick a platform" }),
  views: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce
      .number({ error: "Views must be a whole number" })
      .int("Views must be a whole number")
      .min(0, "Views cannot be negative")
      .max(1e12, "Views look wrong")
      .nullable(),
  ),
  publishedAt: optionalDate,
  content: optionalText(1000),
});

export const researchItemSchema = z.discriminatedUnion("type", [
  articleSchema,
  videoSchema,
  mediaSchema,
  quoteSchema,
  timelineSchema,
  noteSchema,
  questionSchema,
  contextSchema,
  competitorSchema,
]);
export type ResearchItemInput = z.infer<typeof researchItemSchema>;

export type ItemColumns = {
  item_type: ResearchItemType;
  title: string | null;
  content: string | null;
  url: string | null;
  occurred_at: string | null;
  source_id: string | null;
  metadata: { [key: string]: Json };
};

/** Validated input → research_items columns (metadata holds type-specific fields). */
export function toItemColumns(input: ResearchItemInput): ItemColumns {
  const base = { title: null, content: null, url: null, occurred_at: null, source_id: null, metadata: {} };
  switch (input.type) {
    case "article":
    case "video":
      return {
        ...base,
        item_type: input.type,
        title: input.title,
        url: input.url,
        content: input.content,
        source_id: input.sourceId,
        occurred_at: input.publishedAt,
      };
    case "media":
      return {
        ...base,
        item_type: "media",
        title: input.title,
        url: input.url,
        content: input.content,
        source_id: input.sourceId,
        metadata: { media_kind: input.mediaKind },
      };
    case "quote":
      return {
        ...base,
        item_type: "quote",
        content: input.content,
        url: input.url,
        source_id: input.sourceId,
        occurred_at: input.saidAt,
        metadata: { speaker: input.speaker },
      };
    case "timeline":
      return {
        ...base,
        item_type: "timeline",
        title: input.title,
        content: input.content,
        source_id: input.sourceId,
        occurred_at: input.occurredAt,
      };
    case "note":
      return { ...base, item_type: "note", title: input.title, content: input.content };
    case "question":
      return {
        ...base,
        item_type: "question",
        content: input.content,
        metadata: { answered: input.answered, answer: input.answer },
      };
    case "context":
      return { ...base, item_type: "context", title: input.title, content: input.content, source_id: input.sourceId };
    case "competitor":
      return {
        ...base,
        item_type: "competitor",
        title: input.title,
        url: input.url,
        content: input.content,
        occurred_at: input.publishedAt,
        metadata: { channel: input.channel, platform: input.platform, views: input.views },
      };
  }
}

/* ------------------------------------------------------------------------- */
/* metadata (read side)                                                      */
/* ------------------------------------------------------------------------- */

/** Type-specific fields read back from research_items.metadata (never trusted blindly). */
export type ItemMeta = {
  speaker: string | null;
  answered: boolean;
  answer: string | null;
  answeredAt: string | null;
  channel: string | null;
  platform: CompetitorPlatform | null;
  views: number | null;
  mediaKind: MediaKind | null;
  /** produced by an agent (AI suggestion) — shown with an AI badge */
  ai: boolean;
  model: string | null;
  /** source ids the AI cited (all validated against the provided set) */
  sourceIds: string[];
};

const metaSchema = z.object({
  speaker: z.string().max(200).nullish().catch(null),
  answered: z.boolean().nullish().catch(null),
  answer: z.string().max(4000).nullish().catch(null),
  answered_at: z.string().max(40).nullish().catch(null),
  channel: z.string().max(200).nullish().catch(null),
  platform: z.enum(COMPETITOR_PLATFORMS).nullish().catch(null),
  views: z.number().int().min(0).nullish().catch(null),
  media_kind: z.enum(MEDIA_KINDS).nullish().catch(null),
  ai: z.boolean().nullish().catch(null),
  model: z.string().max(120).nullish().catch(null),
  source_ids: z.array(z.string().max(64)).max(50).nullish().catch(null),
});

export function readItemMeta(metadata: Json | null | undefined): ItemMeta {
  const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const m = metaSchema.parse(raw);
  return {
    speaker: m.speaker ?? null,
    answered: m.answered ?? false,
    answer: m.answer ?? null,
    answeredAt: m.answered_at ?? null,
    channel: m.channel ?? null,
    platform: m.platform ?? null,
    views: m.views ?? null,
    mediaKind: m.media_kind ?? null,
    ai: m.ai ?? false,
    model: m.model ?? null,
    sourceIds: m.source_ids ?? [],
  };
}

/* ------------------------------------------------------------------------- */
/* sources                                                                   */
/* ------------------------------------------------------------------------- */

export const sourceFormSchema = z.object({
  url: httpUrl,
  publisher: optionalText(200),
  title: optionalText(500),
  type: z.enum(SOURCE_TYPES, { error: "Pick a source type" }).default("news"),
  summary: optionalText(2000),
});
export type SourceFormInput = z.infer<typeof sourceFormSchema>;

/** Publisher name for a source: the given one, otherwise the link's host. */
export function publisherFor(url: string, publisher: string | null | undefined): string {
  const given = publisher?.trim();
  if (given) return given.slice(0, 200);
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 200) || "Unknown publisher";
  } catch {
    return "Unknown publisher";
  }
}

/* ------------------------------------------------------------------------- */
/* claims (facts)                                                            */
/* ------------------------------------------------------------------------- */

export const claimFormSchema = z.object({
  claim: requiredText(2000, "Write the claim"),
  isCritical: z.boolean().default(true),
});
export type ClaimFormInput = z.infer<typeof claimFormSchema>;

export const linkSourceSchema = z.object({
  factId: z.uuid({ error: "Invalid claim" }),
  sourceId: z.uuid({ error: "Pick a source" }),
  relation: z.enum(CLAIM_RELATIONS, { error: "Pick how the source relates to the claim" }).default("supports"),
  excerpt: optionalText(1000),
  locator: optionalText(200),
});
export type LinkSourceInput = z.infer<typeof linkSourceSchema>;

/** Confidence 0..1; "" → null (not assessed). */
const confidenceField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce
    .number({ error: "Confidence is a number from 0 to 1" })
    .min(0, "Confidence is a number from 0 to 1")
    .max(1, "Confidence is a number from 0 to 1")
    .transform((n) => Math.round(n * 1000) / 1000)
    .nullable(),
);

export const claimStatusSchema = z.object({
  factId: z.uuid({ error: "Invalid claim" }),
  status: z.enum(FACT_STATUSES, { error: "Pick a status" }),
  confidence: confidenceField,
  notes: optionalText(2000),
});
export type ClaimStatusInput = z.infer<typeof claimStatusSchema>;

export const answerQuestionSchema = z
  .object({
    itemId: z.uuid({ error: "Invalid question" }),
    answered: z.boolean(),
    answer: optionalText(4000),
  })
  .refine((q) => !q.answered || q.answer, { message: "Write the answer before marking it answered", path: ["answer"] });
export type AnswerQuestionInput = z.infer<typeof answerQuestionSchema>;

/* ------------------------------------------------------------------------- */
/* workspace tabs                                                            */
/* ------------------------------------------------------------------------- */

export const WORKSPACE_TABS = [
  { key: "overview", label: "Overview" },
  { key: "sources", label: "Sources" },
  { key: "claims", label: "Claims" },
  { key: "timeline", label: "Timeline" },
  { key: "quotes", label: "Quotes" },
  { key: "media", label: "Media" },
  { key: "competitors", label: "Competitors" },
  { key: "questions", label: "Questions" },
  { key: "notes", label: "Notes & context" },
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]["key"];

/** ?tab= → a known tab (anything else → overview). */
export function parseTab(value: string | string[] | undefined): WorkspaceTab {
  const v = Array.isArray(value) ? value[0] : value;
  return WORKSPACE_TABS.find((t) => t.key === v)?.key ?? "overview";
}
