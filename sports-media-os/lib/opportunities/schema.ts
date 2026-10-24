import { z } from "zod";

import type { Enums } from "@/lib/db/client";
import type { ScoreComponentKey } from "@/lib/scoring/opportunity";
import { Constants } from "@/types/database";

import { COMPONENT_KEYS } from "./scoring";

/** Input validation for opportunity actions and list filters (pure, shared by actions and pages). */

export const OPPORTUNITY_STATUSES = Constants.public.Enums.opportunity_status;
export const RADAR_SIGNALS = Constants.public.Enums.radar_signal;
export type OpportunityStatus = Enums<"opportunity_status">;

/** "" / missing → null, otherwise trimmed and length-checked */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const opportunityFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Keep it under 300 characters"),
  description: optionalText(4000),
  why_now: optionalText(1000),
  angle: optionalText(1000),
  hook: optionalText(500),
  competition: optionalText(120),
});
export type OpportunityFields = z.infer<typeof opportunityFieldsSchema>;

export const manualOpportunitySchema = opportunityFieldsSchema.extend({
  sportId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type ManualOpportunityInput = z.infer<typeof manualOpportunitySchema>;

export const componentScoreSchema = z.object({
  id: z.uuid(),
  component: z.enum(COMPONENT_KEYS as [ScoreComponentKey, ...ScoreComponentKey[]], { error: "Pick a score component" }),
  // an empty field must not coerce to 0
  value: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number({ error: "Enter a number from 0 to 100" }).min(0, "0 to 100").max(100, "0 to 100"),
  ),
  reason: z.string().trim().min(3, "Explain why (at least a few words)").max(500, "Keep it under 500 characters"),
});

export const decisionSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2000 characters")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const aiScoringRequestSchema = z.object({
  ids: z.array(z.uuid({ error: "Invalid opportunity id" })).min(1, "Select at least one opportunity").max(50, "AI scoring takes at most 50 opportunities at a time"),
  confirmedCostUsd: z.number().min(0).optional(),
});

export type OpportunityFilters = {
  status?: OpportunityStatus;
  sportId?: string;
  minScore?: number;
  sweetSpot?: boolean;
  signal?: Enums<"radar_signal">;
  search?: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** URL search params → filters. Invalid values are dropped, never trusted. */
export function parseOpportunityFilters(sp: SearchParams): OpportunityFilters {
  const f: OpportunityFilters = {};
  const status = first(sp.status);
  if (status && (OPPORTUNITY_STATUSES as readonly string[]).includes(status)) f.status = status as OpportunityStatus;
  const sport = first(sp.sport);
  if (sport && z.uuid().safeParse(sport).success) f.sportId = sport;
  const min = Number(first(sp.min));
  if (first(sp.min) && Number.isFinite(min) && min > 0 && min <= 100) f.minScore = min;
  if (first(sp.sweet) === "1") f.sweetSpot = true;
  const signal = first(sp.signal);
  if (signal && (RADAR_SIGNALS as readonly string[]).includes(signal)) f.signal = signal as Enums<"radar_signal">;
  const q = first(sp.q);
  if (q) f.search = q.slice(0, 100);
  return f;
}

export function hasFilters(f: OpportunityFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}

/** escape LIKE wildcards so a search for "50%" is literal */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
