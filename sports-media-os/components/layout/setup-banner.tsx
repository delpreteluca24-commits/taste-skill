import { ExternalLink, KeyRound } from "lucide-react";

/**
 * Server-only check of the two secrets the app cannot run without. Values are
 * never read or shown — only whether they exist.
 */
function supabaseRef() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0] || "_";
  } catch {
    return "_";
  }
}

const STEPS = [
  {
    env: "SUPABASE_SECRET_KEY",
    what: "lets the app run searches, source fetching and background jobs",
    where: "Supabase → Project Settings → API Keys → Secret key",
    href: `https://supabase.com/dashboard/project/${supabaseRef()}/settings/api-keys`,
  },
  {
    env: "ANTHROPIC_API_KEY",
    what: "turns on AI scoring, research, scripts, hooks and titles",
    where: "Anthropic Console → API Keys → Create key (set a spend limit)",
    href: "https://console.anthropic.com/settings/keys",
  },
  {
    env: "ANTHROPIC_WORKSPACE_ID",
    what: "is required because the Anthropic key is a user-level key (sk-ant-usr-…) not bound to a workspace — or replace it with a workspace key (sk-ant-api03-…)",
    where: "Anthropic Console → Settings → Workspaces → copy the ID (wrkspc_…)",
    href: "https://console.anthropic.com/settings/workspaces",
  },
] as const;

function isMissing(env: (typeof STEPS)[number]["env"]): boolean {
  if (env === "SUPABASE_SECRET_KEY") return !process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (env === "ANTHROPIC_WORKSPACE_ID") {
    return Boolean(process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-usr-")) && !process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  }
  return !process.env[env];
}

export function SetupBanner() {
  const missing = STEPS.filter((s) => isMissing(s.env));
  if (missing.length === 0) return null;
  return (
    <div role="alert" data-testid="setup-banner" className="mb-5 rounded-2xl border border-warning/40 bg-warning/10 p-4 md:p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold tracking-wide uppercase">Setup incomplete — {missing.length} setting{missing.length > 1 ? "s" : ""} missing</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Until then, searches and AI buttons stay queued. Add each key in Vercel → Project → Settings → Environment Variables, then Redeploy.
          </p>
          <ol className="mt-3 grid gap-2 text-sm">
            {missing.map((s, i) => (
              <li key={s.env} className="rounded-lg border bg-card/60 px-3 py-2">
                <span className="font-semibold">{i + 1}. <code className="text-brand">{s.env}</code></span> — {s.what}.
                <a href={s.href} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-xs underline">
                  {s.where} <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ol>
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand underline"
          >
            Open Vercel <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
