import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { listSports } from "@/lib/projects/service";
import { listTimezones } from "@/lib/projects/timezones";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const sports = await listSports();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New project" description="Each project is a channel or brand with its own pipeline, content and analytics." />
      <div className="rounded-lg border bg-card p-6">
        <CreateProjectForm sports={sports} timezones={listTimezones()} />
      </div>
    </div>
  );
}
