import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="analytics"
      capabilities={[
        "Views, likes, comments, shares, subscribers, watch time, average % viewed, CTR when available",
        "Predicted vs actual, prediction error",
        "Learning loop: winning and losing patterns by hook, length, sport, topic, format, thumbnail, title",
      ]}
    />
  );
}
