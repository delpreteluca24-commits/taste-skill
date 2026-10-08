import { z } from "zod";

/**
 * JSON API field mapping stored in connectors.config (jsonb). Pure zod, safe to
 * import from client components. Paths are dot paths into each item
 * ("headline", "links.web", "teams.0.name"); numeric segments index arrays.
 */

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const DOT_PATH = /^[A-Za-z0-9_$@-]+(\.[A-Za-z0-9_$@-]+)*$/;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const dotPathSchema = z
  .string()
  .trim()
  .max(200)
  .regex(DOT_PATH, { message: "Use a dot path like data.items or teams.0.name" })
  .refine((p) => p.split(".").every((s) => !FORBIDDEN_SEGMENTS.has(s)), { message: "Path segment not allowed" });

const optionalPath = z.preprocess(emptyToUndefined, dotPathSchema.optional());

/** One or more dot paths separated by commas (joined into one title). */
export const titlePathsSchema = z
  .string()
  .trim()
  .min(1, { message: "Title path is required" })
  .max(400)
  .refine((v) => v.split(",").every((p) => dotPathSchema.safeParse(p.trim()).success), {
    message: "Use dot paths, comma-separated to combine (e.g. home.name,away.name)",
  });

export const sourcesMappingSchema = z.object({
  /** where the list is in the response; empty = the response itself is the list */
  itemsPath: optionalPath,
  titlePath: titlePathsSchema,
  urlPath: dotPathSchema,
  publishedAtPath: optionalPath,
  summaryPath: optionalPath,
  authorPath: optionalPath,
});

export const eventsMappingSchema = z.object({
  itemsPath: optionalPath,
  /** comma-separated paths are joined with " vs " (e.g. homeTeam.name,awayTeam.name) */
  titlePath: titlePathsSchema,
  startsAtPath: optionalPath,
  endsAtPath: optionalPath,
  competitionPath: optionalPath,
  venuePath: optionalPath,
  statusPath: optionalPath,
  /** provider id used to update the same event on every fetch */
  externalIdPath: optionalPath,
});

export type SourcesMapping = z.infer<typeof sourcesMappingSchema>;
export type EventsMapping = z.infer<typeof eventsMappingSchema>;

export const MAPPING_FIELDS = {
  sources: ["itemsPath", "titlePath", "urlPath", "publishedAtPath", "summaryPath", "authorPath"],
  events: ["itemsPath", "titlePath", "startsAtPath", "endsAtPath", "competitionPath", "venuePath", "statusPath", "externalIdPath"],
} as const;

export type MappingField = (typeof MAPPING_FIELDS)[keyof typeof MAPPING_FIELDS][number];

export type ParsedConfig =
  | { ok: true; target: "sources"; mapping: SourcesMapping }
  | { ok: true; target: "events"; mapping: EventsMapping }
  | { ok: false; error: string };

/** Validates a stored config for the connector's target (workers re-check before use). */
export function parseConnectorConfig(target: string, config: unknown): ParsedConfig {
  if (target === "sources") {
    const r = sourcesMappingSchema.safeParse(config ?? {});
    return r.success ? { ok: true, target, mapping: r.data } : { ok: false, error: z.prettifyError(r.error) };
  }
  if (target === "events") {
    const r = eventsMappingSchema.safeParse(config ?? {});
    return r.success ? { ok: true, target, mapping: r.data } : { ok: false, error: z.prettifyError(r.error) };
  }
  return { ok: false, error: `Unknown target "${target}"` };
}
