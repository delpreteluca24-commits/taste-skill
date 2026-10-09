import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="calendar"
      capabilities={[
        "Day / week / month views",
        "Date, time, platform and status per content item",
        "Drag to reschedule",
      ]}
    />
  );
}
