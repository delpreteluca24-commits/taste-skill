import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Sports Radar" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="radar"
      capabilities={[
        "Sports, events and latest news from connected sources (no invented data)",
        "Emerging stories with priority and score",
        "Filters: sport, date, score, trend status, competition, status",
      ]}
    />
  );
}
