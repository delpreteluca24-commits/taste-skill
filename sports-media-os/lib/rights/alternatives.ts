/**
 * STORY ≠ FOOTAGE — editorial alternatives engine.
 *
 * A strong story is never dropped because the original footage is unusable.
 * Given what we know about a story (asset rights, research material) this
 * suggests production formats that keep it publishable and original.
 */

export const EDITORIAL_FORMATS = [
  { value: "original_commentary", label: "Original commentary", risk: "none" },
  { value: "voiceover", label: "Voiceover", risk: "none" },
  { value: "statistics", label: "Statistics", risk: "none" },
  { value: "graphics", label: "Graphics", risk: "none" },
  { value: "timeline", label: "Timeline", risk: "none" },
  { value: "animation", label: "Animation", risk: "none" },
  { value: "map", label: "Maps", risk: "none" },
  { value: "original_visuals", label: "Original visuals", risk: "none" },
  { value: "authorized_footage", label: "Authorized footage", risk: "documented" },
  { value: "licensed_footage", label: "Licensed footage", risk: "documented" },
  { value: "creator_provided", label: "Creator / athlete material", risk: "documented" },
  { value: "public_sources", label: "Compatible public sources", risk: "check" },
  { value: "screenshots", label: "Screenshots (only when appropriate)", risk: "check" },
] as const;

export type EditorialFormat = (typeof EDITORIAL_FORMATS)[number]["value"];

export type AssetRightsSummary = {
  status: "green" | "yellow" | "red" | "unchecked";
  usable: boolean;
  ownership?: string | null;
  kind?: string | null;
};

export type StoryMaterial = {
  assets: AssetRightsSummary[];
  /** counts of research material (drives data/timeline formats) */
  confirmedFacts: number;
  timelineItems: number;
  quotes: number;
  hasStatistics: boolean;
  hasLocations: boolean;
};

export type FootageStatus = "usable" | "partial" | "unavailable" | "none";

export type FormatSuggestion = {
  format: EditorialFormat;
  label: string;
  score: number;
  reason: string;
  caution?: string;
};

export type AlternativesResult = {
  footageStatus: FootageStatus;
  headline: string;
  suggestions: FormatSuggestion[];
};

export function footageStatus(assets: AssetRightsSummary[]): FootageStatus {
  if (assets.length === 0) return "none";
  const usable = assets.filter((a) => a.usable).length;
  if (usable === assets.length) return "usable";
  if (usable > 0) return "partial";
  return "unavailable";
}

export function suggestEditorialAlternatives(m: StoryMaterial): AlternativesResult {
  const status = footageStatus(m.assets);
  const out: FormatSuggestion[] = [];
  const add = (format: EditorialFormat, score: number, reason: string, caution?: string) => {
    const label = EDITORIAL_FORMATS.find((f) => f.value === format)!.label;
    out.push({ format, label, score: Math.max(0, Math.min(100, Math.round(score))), reason, caution });
  };

  // Always available, zero rights risk
  add("original_commentary", 90, "Our own analysis and voice — fully original, monetizable.");
  add("voiceover", 85, "Narrate the story over original visuals; works with any footage status.");
  add("original_visuals", 75, "Custom illustrations, typography and motion — no third-party material.");
  add("graphics", m.confirmedFacts > 0 ? 80 : 60, m.confirmedFacts > 0 ? `${m.confirmedFacts} confirmed fact(s) to visualise.` : "Text and data cards; strongest once facts are confirmed.");
  add("statistics", m.hasStatistics ? 85 : 45, m.hasStatistics ? "The research contains numbers worth charting." : "Add verified stats to unlock this format.");
  add("timeline", m.timelineItems >= 3 ? 80 : m.timelineItems > 0 ? 55 : 35, m.timelineItems > 0 ? `${m.timelineItems} timeline event(s) in research.` : "Build a timeline in the research workspace first.");
  add("animation", 55, "Animated recreation of key moments (diagrams, not broadcast frames).");
  if (m.hasLocations) add("map", 65, "Locations in the story can be shown on maps.");

  // Footage-based formats depend on cleared assets
  const greenOwned = m.assets.filter((a) => a.usable && (a.ownership === "licensed" || a.status === "green"));
  if (greenOwned.length > 0) {
    add("licensed_footage", 80, `${greenOwned.length} cleared asset(s) available.`);
  } else {
    add("authorized_footage", 40, "Ask clubs, athletes or rights holders for permission.", "Use only after a GREEN or approved YELLOW rights check.");
  }
  add("creator_provided", 45, "Material sent directly by creators/athletes who hold the rights.", "Record authorization and evidence in the Rights Center.");
  add("public_sources", 40, "Official public sources whose terms allow reuse.", "Check each source's terms; classify before use.");
  add("screenshots", 25, "Limited, transformative use for commentary only.", "Only when appropriate: small excerpts, critical commentary, never the main visual. Classify as YELLOW at least.");

  if (m.quotes > 0) {
    const vo = out.find((s) => s.format === "voiceover");
    if (vo) vo.reason += ` ${m.quotes} attributable quote(s) to narrate.`;
  }

  // When footage is unavailable, original formats are the plan, not a fallback
  if (status === "unavailable" || status === "none") {
    for (const s of out) {
      if (EDITORIAL_FORMATS.find((f) => f.value === s.format)?.risk === "none") s.score = Math.min(100, s.score + 5);
    }
  }

  out.sort((a, b) => b.score - a.score);
  const headline =
    status === "usable"
      ? "Footage is cleared. Original formats can still raise originality and monetization."
      : status === "partial"
        ? "Some footage is cleared. Combine it with original formats for the rest."
        : status === "unavailable"
          ? "No usable footage — the story stays approved. Produce it with original formats."
          : "No footage linked. Plan the story around original formats.";
  return { footageStatus: status, headline, suggestions: out };
}
