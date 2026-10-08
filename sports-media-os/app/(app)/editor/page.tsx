import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/common/module-placeholder";

export const metadata: Metadata = { title: "Editor" };

export default function Page() {
  return (
    <ModulePlaceholder
      module="editor"
      capabilities={[
        "Trim, crop, caption style and position, zoom, mute, volume, export",
        "9:16 1080×1920 auto-reframe (speaker → face → subject → smart center crop)",
        "Captions SRT / ASS with clean, bold, creator presets",
      ]}
    />
  );
}
