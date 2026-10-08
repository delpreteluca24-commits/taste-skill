import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Opportunities" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="opportunities"
      capabilities={[
        "Weighted opportunity score 0-100 with explanation (trend 20%, timeliness 15%, curiosity 15%, originality 15%, audience 10%, competition gap 10%, feasibility 5%, rights 5%, monetization 5%)",
        "Status workflow new → researching → approved → production → ready → published",
        "Human approval checkpoint",
      ]}
    />
  );
}
