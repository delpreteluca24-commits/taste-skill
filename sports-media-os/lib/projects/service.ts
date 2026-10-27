import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import { PROJECT_COOKIE, slugify, type CreateProjectInput } from "./schema";

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: "active" | "paused" | "archived";
  color: string | null;
};

/** Projects the current user belongs to (RLS-filtered). */
export const listProjects = cache(async (): Promise<ProjectSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, timezone, status, color")
    .neq("status", "archived")
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("projects.list_failed", { code: error.code, message: error.message });
    throw new Error("Could not load projects");
  }
  return data ?? [];
});

/**
 * Active project = the one in the cookie if the user can still see it,
 * otherwise their first project. Never trusts the cookie on its own.
 */
export const getActiveProject = cache(async (): Promise<ProjectSummary | null> => {
  const projects = await listProjects();
  if (projects.length === 0) return null;
  const selected = (await cookies()).get(PROJECT_COOKIE)?.value;
  return projects.find((p) => p.id === selected) ?? projects[0];
});

export async function setActiveProjectCookie(projectId: string) {
  (await cookies()).set(PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Creates a project owned by `ownerId`; retries with a suffix on slug collision. */
export async function createProject(ownerId: string, input: CreateProjectInput) {
  const supabase = await createClient();
  const base = slugify(input.name);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 55)}-${attempt + 1}`;
    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: ownerId,
        name: input.name,
        slug,
        description: input.description ?? null,
        primary_sport_id: input.primarySportId ?? null,
        language: input.language,
        timezone: input.timezone,
      })
      .select("id")
      .single();
    if (!error) return { data, error: null };
    if (error.code !== "23505") return { data: null, error };
  }
  return { data: null, error: { code: "23505", message: "slug collision" } };
}

export async function listSports() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name");
  if (error) {
    logger.error("sports.list_failed", { code: error.code, message: error.message });
    return [];
  }
  return data ?? [];
}
