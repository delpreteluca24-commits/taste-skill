import { z } from "zod";

/**
 * Environment access, validated lazily (so `next build` never needs secrets).
 *
 * Public values are referenced literally (`process.env.NEXT_PUBLIC_…`) because
 * Next.js inlines them at build time only when written that way.
 * Server-only secrets live in `lib/env.server.ts` (guarded by `server-only`).
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, { message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing" }),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cachedPublic: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // the legacy anon key works too; the publishable key is the current Supabase standard
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment: ${z.prettifyError(parsed.error)}`);
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}
