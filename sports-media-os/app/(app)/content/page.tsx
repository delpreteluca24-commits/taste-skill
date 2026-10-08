import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Content" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="content"
      capabilities={[
        "Kanban: idea → research → script → production → review → ready → scheduled → published → analyzing",
        "Script studio with immutable versions (enforced in the database)",
        "Hook generator: curiosity, controversial, shock, mystery, story, statistical — each scored",
      ]}
    />
  );
}
