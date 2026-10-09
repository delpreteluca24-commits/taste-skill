import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Thumbnails" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="thumbnails"
      capabilities={[
        "5 thumbnail concepts per content item: headline, visual concept, subject, emotion, contrast, curiosity angle",
        "5 title variants scored on curiosity, clarity, CTR potential and accuracy — no false clickbait",
        "Image-generation-ready prompts",
      ]}
    />
  );
}
