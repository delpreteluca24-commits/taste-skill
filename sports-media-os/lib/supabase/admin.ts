import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Service-role client: BYPASSES RLS. Only for workers and scripts.
 * Every query made with it must be scoped to a project explicitly
 * (see workers/context.ts → loadOwned).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for workers");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
