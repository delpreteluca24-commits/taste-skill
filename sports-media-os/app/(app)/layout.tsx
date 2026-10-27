import { redirect } from "next/navigation";

import { AiStatusProvider } from "@/components/ai/ai-status";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { DrainKicker } from "@/components/layout/drain-kicker";
import { SetupBanner } from "@/components/layout/setup-banner";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { aiSwitchedOff } from "@/lib/ai/switch";
import { requireUser } from "@/lib/auth/dal";
import { getActiveProject, listProjects } from "@/lib/projects/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [projects, active] = await Promise.all([listProjects(), getActiveProject()]);
  if (!active) redirect("/welcome");

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/70 px-3 backdrop-blur-md md:px-6">
          <MobileNav />
          <ProjectSwitcher projects={projects.map(({ id, name }) => ({ id, name }))} activeProjectId={active.id} />
          <div className="ml-auto flex items-center gap-2">
            <UserMenu email={user.email} displayName={user.displayName} role={user.role} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 pt-5 pb-24 md:px-6 md:py-7">
          <DrainKicker />
          <SetupBanner />
          <AiStatusProvider enabled={!aiSwitchedOff()}>{children}</AiStatusProvider>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
