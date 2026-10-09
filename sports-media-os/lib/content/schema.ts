import { z } from "zod";

import type { Enums } from "@/lib/db/client";

import { CONTENT_STAGE_ORDER, type ContentStage } from "./stages";

/** Input validation for content actions and the item page tabs (pure, shared by actions, pages and tests). */

export type ContentFormat = Enums<"content_format">;

export const CONTENT_FORMATS = ["short", "long", "post"] as const satisfies readonly ContentFormat[];

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  short: "Short",
  long: "Long-form",
  post: "Post",
};

export const FORMAT_HINTS: Record<ContentFormat, string> = {
  short: "Vertical video under ~60 s (Shorts, TikTok, Reels)",
  long: "Horizontal video of several minutes (YouTube)",
  post: "Text or image post, no video",
};

/** "" / missing → null, otherwise trimmed and length-checked */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const contentFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Keep it under 300 characters"),
  format: z.enum(CONTENT_FORMATS, { error: "Pick a format: short, long or post" }),
  description: optionalText(4000),
});
export type ContentFields = z.infer<typeof contentFieldsSchema>;

/** New idea = the same editable fields; it always starts in IDEA. */
export const ideaSchema = contentFieldsSchema;
export type IdeaInput = ContentFields;

export const stageSchema = z.enum(CONTENT_STAGE_ORDER, { error: "Unknown stage" });

export const moveSchema = z.object({
  id: z.uuid({ error: "Invalid content item" }),
  stage: stageSchema,
  /** drop index in the target column (the moved card excluded); missing → end of the column */
  index: z.number().int().min(0).max(10_000).optional(),
});
export type MoveInput = z.infer<typeof moveSchema>;

export const storyDecisionSchema = z.object({
  storyId: z.uuid({ error: "Invalid story" }),
  decision: z.enum(["approved", "rejected"], { error: "Approve or reject" }),
  notes: optionalText(2000),
});

export function isContentStage(value: unknown): value is ContentStage {
  return typeof value === "string" && (CONTENT_STAGE_ORDER as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------- */
/* Item page tabs (?tab=…)                                                   */
/* ------------------------------------------------------------------------- */

export const DETAIL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "script", label: "Script" },
  { key: "hooks", label: "Hooks" },
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]["key"];

/** ?tab= → a known tab (anything else → overview). */
export function parseDetailTab(value: string | string[] | undefined): DetailTab {
  const v = Array.isArray(value) ? value[0] : value;
  return DETAIL_TABS.find((t) => t.key === v)?.key ?? "overview";
}
