import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Per-request Supabase client bound to the user's session cookies.
 * Every query runs as the signed-in user, so RLS is always enforced.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // Safe to ignore — proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
