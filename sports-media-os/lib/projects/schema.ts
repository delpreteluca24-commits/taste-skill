import { z } from "zod";

export const PROJECT_COOKIE = "smos_project";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Lowercase, ASCII, dash-separated; max 60 chars. Empty input → "project". */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "project";
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, { message: "Name is required" }).max(80),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  primarySportId: z.preprocess(emptyToUndefined, z.uuid({ message: "Invalid sport" }).optional()),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, { message: "Use a language code like en or it" })
    .default("en"),
  timezone: z
    .string()
    .trim()
    .default("UTC")
    .refine(isValidTimezone, { message: "Unknown timezone" }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
