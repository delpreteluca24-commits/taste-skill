import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Database client type for domain services. Services take it as a parameter so
 * the same code runs with the user's client (RLS, server actions/pages) and the
 * service-role client (workers — then every query MUST be scoped to a project).
 */
export type Db = SupabaseClient<Database>;
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
