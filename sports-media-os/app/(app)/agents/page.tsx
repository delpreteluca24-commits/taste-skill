import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="agents"
      capabilities={[
        "Orchestrator, Sports Radar, Trend Hunter, Researcher, Fact Checker, Rights, Story, Hook, Editor, Thumbnail, Publisher, Analytics, CEO",
        "Status, last/next run, tasks, errors, performance",
        "Human approval for opportunity, story, production and publishing",
      ]}
    />
  );
}
