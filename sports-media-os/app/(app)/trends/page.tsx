import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Trends" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="trends"
      capabilities={[
        "Connectors normalize external data: Source → Trend → Opportunity",
        "Each source carries url, type, published/retrieved time, credibility, license status",
        "Trend velocity, volume and status (emerging → expired)",
      ]}
    />
  );
}
