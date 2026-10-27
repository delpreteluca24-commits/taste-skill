import type { Metadata } from "next";
import { Radar } from "lucide-react";

import { safeRedirectPath } from "@/lib/auth/paths";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? safeRedirectPath(next) : undefined;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-md bg-brand text-brand-foreground">
            <Radar className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Sports Media OS</p>
            <p className="text-xs text-muted-foreground">Control room</p>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h1 className="text-base font-semibold">Sign in</h1>
          <p className="mt-1 mb-5 text-xs text-muted-foreground">Owner access only. Accounts are created by an admin.</p>
          <LoginForm next={nextPath} />
        </div>
      </div>
    </main>
  );
}
