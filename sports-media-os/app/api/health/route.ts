import { NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + dependency check for uptime monitors. Reveals no configuration details. */
export async function GET() {
  const started = Date.now();
  let auth: "ok" | "down" = "down";
  try {
    const env = getPublicEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    auth = res.ok ? "ok" : "down";
  } catch {
    auth = "down";
  }
  const healthy = auth === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", supabase: auth, latency_ms: Date.now() - started },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
