import { EDITORIAL_FORMATS, type EditorialFormat } from "@/lib/rights/alternatives";

/**
 * STORY ≠ FOOTAGE for writers. A script is written for the story's chosen
 * production formats (stories.production_formats). Footage-based formats still
 * need cleared assets (GREEN or approved YELLOW), so a script must always work
 * as narration over original visuals.
 */

/** formats that rely on third-party or supplied material (rights checked per asset) */
export const FOOTAGE_FORMATS: ReadonlySet<EditorialFormat> = new Set<EditorialFormat>([
  "authorized_footage",
  "licensed_footage",
  "creator_provided",
  "public_sources",
  "screenshots",
]);

export function formatLabel(format: EditorialFormat): string {
  return EDITORIAL_FORMATS.find((f) => f.value === format)?.label ?? format;
}

/** true when nothing footage-based is planned (also when no format was chosen yet) */
export function isOriginalOnly(formats: readonly EditorialFormat[]): boolean {
  return formats.every((f) => !FOOTAGE_FORMATS.has(f));
}

export type ProductionGuidance = {
  originalOnly: boolean;
  chosen: boolean;
  labels: string[];
  /** instruction for the model (prompt data block) */
  guidance: string;
};

export function productionGuidance(formats: readonly EditorialFormat[]): ProductionGuidance {
  const labels = formats.map(formatLabel);
  const originalOnly = isOriginalOnly(formats);
  let guidance: string;
  if (formats.length === 0) {
    guidance =
      "No production formats chosen yet. Assume original formats only: voiceover over original graphics, statistics cards and timeline visuals. Never refer to footage, clips or replays.";
  } else if (originalOnly) {
    guidance = `Production formats: ${labels.join(", ")}. No third-party footage is planned: write narration that works over original visuals. Never refer to footage, clips or replays ("watch this", "look at the replay").`;
  } else {
    guidance = `Production formats: ${labels.join(", ")}. Footage still needs a cleared rights check per asset, so the script must work as narration on its own; mark optional footage moments as [optional cleared footage: …].`;
  }
  return { originalOnly, chosen: formats.length > 0, labels, guidance };
}
