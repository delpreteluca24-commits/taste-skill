import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Research" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="research"
      capabilities={[
        "Research workspace per opportunity: sources, articles, videos, quotes, timeline, notes, questions, context",
        "Fact check: confirmed / probable / uncertain / false with confidence (READY is blocked by unconfirmed critical facts — already enforced in the database)",
        "Rights center: GREEN / YELLOW / RED (RED material is blocked from production — already enforced in the database)",
      ]}
    />
  );
}
