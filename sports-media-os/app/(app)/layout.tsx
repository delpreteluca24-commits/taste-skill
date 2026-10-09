import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { UserMenu } from "@/components/layout/user-menu";
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
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-5">
          <MobileNav />
          <ProjectSwitcher projects={projects.map(({ id, name }) => ({ id, name }))} activeProjectId={active.id} />
          <div className="ml-auto flex items-center gap-2">
            <UserMenu email={user.email} displayName={user.displayName} role={user.role} />
          </div>
        </header>
        <main className="flex-1 px-3 py-4 md:px-5 md:py-5">{children}</main>
      </div>
    </div>
  );
}
