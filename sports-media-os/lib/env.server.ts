import "server-only";

import { z } from "zod";

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/** Server-only secrets. Never import this module from a Client Component. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}

/** Which AI providers have credentials configured (never exposes the keys). */
export function configuredAIProviders(): { anthropic: boolean; openai: boolean } {
  const env = getServerEnv();
  return { anthropic: Boolean(env.ANTHROPIC_API_KEY), openai: Boolean(env.OPENAI_API_KEY) };
}
