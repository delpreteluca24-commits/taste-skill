import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Clips" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="clips"
      capabilities={[
        "Upload MP4 / MOV / MKV / WEBM directly to storage",
        "Async worker pipeline: audio → faster-whisper transcript → scene detection → candidates → heuristic + AI ranking",
        "Virality potential score (not a guarantee) with 12-factor breakdown",
      ]}
    />
  );
}
