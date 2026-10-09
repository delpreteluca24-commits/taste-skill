import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Radar } from "lucide-react";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { requireUser } from "@/lib/auth/dal";
import { listProjects, listSports } from "@/lib/projects/service";
import { listTimezones } from "@/lib/projects/timezones";

export const metadata: Metadata = { title: "Welcome" };

/** First-run onboarding: a user without projects lands here. */
export default async function WelcomePage() {
  const user = await requireUser();
  const [projects, sports] = await Promise.all([listProjects(), listSports()]);
  if (projects.length > 0) redirect("/dashboard");

  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl content-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-md bg-brand text-brand-foreground">
          <Radar className="size-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">Welcome{user.displayName ? `, ${user.displayName}` : ""}</p>
          <p className="text-xs text-muted-foreground">Create your first project (a channel or brand) to open the control room.</p>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <CreateProjectForm sports={sports} timezones={listTimezones()} />
      </div>
    </main>
  );
}
