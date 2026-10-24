import { z } from "zod";

import { Constants, type Json } from "@/types/database";

import { eventsMappingSchema, MAPPING_FIELDS, sourcesMappingSchema, type MappingField } from "./config";

/**
 * Connector form contract (create / edit). Client-safe: no Node APIs.
 * The server action additionally runs the SSRF URL policy (lib/net) on `url`.
 */

export const CONNECTOR_KINDS = Constants.public.Enums.connector_kind;
export const CONNECTOR_TARGETS = ["sources", "events"] as const;
export const LICENSE_STATUSES = Constants.public.Enums.license_status;

export const KIND_LABELS: Record<(typeof CONNECTOR_KINDS)[number], string> = { rss: "RSS / Atom feed", json_api: "JSON API" };
export const TARGET_LABELS: Record<(typeof CONNECTOR_TARGETS)[number], string> = {
  sources: "Sources (article links)",
  events: "Events (fixtures)",
};

export const MAPPING_LABELS: Record<MappingField, { label: string; placeholder: string }> = {
  itemsPath: { label: "Items path", placeholder: "data.items (empty = response is the list)" },
  titlePath: { label: "Title path", placeholder: "headline · or home.name,away.name" },
  urlPath: { label: "URL path", placeholder: "links.web" },
  publishedAtPath: { label: "Published-at path", placeholder: "published" },
  summaryPath: { label: "Summary path", placeholder: "standfirst" },
  authorPath: { label: "Author path", placeholder: "byline" },
  startsAtPath: { label: "Starts-at path", placeholder: "kickoff" },
  endsAtPath: { label: "Ends-at path", placeholder: "end" },
  competitionPath: { label: "Competition path", placeholder: "league.name" },
  venuePath: { label: "Venue path", placeholder: "venue.name" },
  statusPath: { label: "Status path", placeholder: "status" },
  externalIdPath: { label: "External id path", placeholder: "id" },
};

export const ALL_MAPPING_FIELDS: readonly MappingField[] = [...new Set([...MAPPING_FIELDS.sources, ...MAPPING_FIELDS.events])];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = z.preprocess(emptyToUndefined, z.string().trim().max(400).optional());

export const connectorFormSchema = z
  .object({
    name: z.string().trim().min(1, { message: "Name is required" }).max(120),
    kind: z.enum(CONNECTOR_KINDS, { message: "Choose RSS or JSON API" }),
    url: z
      .string()
      .trim()
      .min(1, { message: "URL is required" })
      .max(2048, { message: "URL is too long" })
      .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), { message: "Enter a full http(s) URL" }),
    target: z.enum(CONNECTOR_TARGETS).default("sources"),
    sportId: z.preprocess(emptyToUndefined, z.uuid({ message: "Invalid sport" }).optional()),
    credibility: z.preprocess(
      emptyToUndefined,
      z.coerce.number({ message: "Use a number between 0 and 1" }).min(0, { message: "Min 0" }).max(1, { message: "Max 1" }).optional(),
    ),
    defaultLicense: z.enum(LICENSE_STATUSES).default("unknown"),
    fetchIntervalMinutes: z.coerce
      .number({ message: "Use a number of minutes" })
      .int({ message: "Whole minutes only" })
      .min(15, { message: "At least 15 minutes" })
      .max(1440, { message: "At most 1440 minutes (24 h)" })
      .default(60),
    enabled: z.boolean().default(true),
    itemsPath: optionalText,
    titlePath: optionalText,
    urlPath: optionalText,
    publishedAtPath: optionalText,
    summaryPath: optionalText,
    authorPath: optionalText,
    startsAtPath: optionalText,
    endsAtPath: optionalText,
    competitionPath: optionalText,
    venuePath: optionalText,
    statusPath: optionalText,
    externalIdPath: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.kind === "rss" && v.target === "events") {
      ctx.addIssue({ code: "custom", path: ["target"], message: "RSS feeds create sources; use a JSON API for events" });
      return;
    }
    if (v.kind !== "json_api") return;
    const schema = v.target === "events" ? eventsMappingSchema : sourcesMappingSchema;
    const result = schema.safeParse(pickMapping(v, v.target));
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? "titlePath");
        const message = issue.code === "invalid_type" ? "Required for a JSON API connector" : issue.message;
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }
  });

export type ConnectorFormInput = z.infer<typeof connectorFormSchema>;

function pickMapping(v: Partial<Record<MappingField, string | undefined>>, target: "sources" | "events") {
  return Object.fromEntries(MAPPING_FIELDS[target].map((f) => [f, v[f]]).filter(([, value]) => value !== undefined));
}

/** connectors.config for the validated form: only the target's mapping, only for JSON APIs. */
export function toConnectorConfig(input: ConnectorFormInput): { [key: string]: Json } {
  if (input.kind !== "json_api") return {};
  const schema = input.target === "events" ? eventsMappingSchema : sourcesMappingSchema;
  const parsed = schema.parse(pickMapping(input, input.target));
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as { [key: string]: Json };
}

/** Raw FormData → schema input (checkbox → boolean). */
export function readConnectorForm(formData: FormData): Record<string, unknown> {
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: value("name"),
    kind: value("kind"),
    url: value("url"),
    target: value("target"),
    sportId: value("sportId"),
    credibility: value("credibility"),
    defaultLicense: value("defaultLicense"),
    fetchIntervalMinutes: value("fetchIntervalMinutes"),
    enabled: formData.get("enabled") === "on",
    ...Object.fromEntries(ALL_MAPPING_FIELDS.map((f) => [f, value(f)])),
  };
}
