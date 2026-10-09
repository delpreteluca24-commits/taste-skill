import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export const E2E_USER_FILE = "e2e/.auth/user.json";

export type E2EUser = { id: string; email: string; password: string };

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (.env.local)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
