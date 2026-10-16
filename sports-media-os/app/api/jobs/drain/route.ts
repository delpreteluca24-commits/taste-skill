import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drainJobs } from "@/workers/drain";
import { handlers } from "@/workers/handlers/index";

export const dynamic = "force-dynamic";
// Hosted mode without a long-running worker: queued jobs run here.
export const maxDuration = 300;

function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function drain(request: NextRequest) {
  if (!hasCronSecret(request)) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await drainJobs(createAdminClient(), handlers, `drain:${crypto.randomUUID()}`, {
    budgetMs: (maxDuration - 60) * 1000,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = drain; // Vercel Cron
export const POST = drain; // the app, while a job is queued
