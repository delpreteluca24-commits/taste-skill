/**
 * Single source of truth for app modules: sidebar entries, page titles and
 * the milestone in which each module becomes functional.
 */
export type ModuleKey =
  | "dashboard"
  | "radar"
  | "trends"
  | "opportunities"
  | "research"
  | "rights"
  | "content"
  | "clips"
  | "editor"
  | "thumbnails"
  | "calendar"
  | "analytics"
  | "agents"
  | "settings";

export type ModuleDefinition = {
  key: ModuleKey;
  href: `/${string}`;
  label: string;
  description: string;
  milestone: number;
  group: "operate" | "intel" | "produce" | "distribute" | "system";
};

export const MODULES: readonly ModuleDefinition[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", group: "operate", milestone: 1,
    description: "Control room: what to make today, what is in production, what is performing." },
  { key: "radar", href: "/radar", label: "Sports Radar", group: "intel", milestone: 2,
    description: "Sports, events, latest news and emerging stories, ranked by priority." },
  { key: "trends", href: "/trends", label: "Trends", group: "intel", milestone: 2,
    description: "Signals normalized from connected sources: Source → Trend → Opportunity." },
  { key: "opportunities", href: "/opportunities", label: "Opportunities", group: "intel", milestone: 2,
    description: "Scored content opportunities with why-now, angle, hook and explained score." },
  { key: "research", href: "/research", label: "Research", group: "intel", milestone: 2,
    description: "Research workspace per opportunity: sources, claims, timeline, quotes, media, competitors, questions." },
  { key: "rights", href: "/rights", label: "Rights Center", group: "intel", milestone: 2,
    description: "Rights-first asset classification (GREEN / YELLOW / RED) and usage approvals." },
  { key: "content", href: "/content", label: "Content", group: "produce", milestone: 2,
    description: "Kanban from idea to analyzing, with Script Studio and Hook Studio." },
  { key: "clips", href: "/clips", label: "Clips", group: "produce", milestone: 3,
    description: "Long-form ingestion, transcription, scene detection and ranked clip candidates." },
  { key: "editor", href: "/editor", label: "Editor", group: "produce", milestone: 4,
    description: "Shorts editor: trim, crop, captions, zoom, audio, export." },
  { key: "thumbnails", href: "/thumbnails", label: "Thumbnails", group: "produce", milestone: 4,
    description: "Thumbnail concepts and title variants scored for curiosity, clarity and accuracy." },
  { key: "calendar", href: "/calendar", label: "Calendar", group: "distribute", milestone: 5,
    description: "Day, week and month planning across YouTube, TikTok and Instagram." },
  { key: "analytics", href: "/analytics", label: "Analytics", group: "distribute", milestone: 5,
    description: "Performance vs prediction, winning and losing patterns." },
  { key: "agents", href: "/agents", label: "Agents", group: "system", milestone: 6,
    description: "Agent status, runs, tasks, errors and human approvals." },
  { key: "settings", href: "/settings", label: "Settings", group: "system", milestone: 1,
    description: "AI provider, defaults, thresholds, publishing and connections." },
] as const;

export const NAV_GROUPS: { key: ModuleDefinition["group"]; label: string }[] = [
  { key: "operate", label: "Operate" },
  { key: "intel", label: "Intelligence" },
  { key: "produce", label: "Production" },
  { key: "distribute", label: "Distribution" },
  { key: "system", label: "System" },
];

/** Milestone currently delivered — modules above it render their roadmap placeholder. */
export const CURRENT_MILESTONE = 2;

export function getModule(key: ModuleKey): ModuleDefinition {
  const found = MODULES.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown module: ${key}`);
  return found;
}

export function isModuleAvailable(module: ModuleDefinition, milestone = CURRENT_MILESTONE): boolean {
  return module.milestone <= milestone;
}

/** Active nav item for a pathname: exact match or nested route. */
export function activeModuleKey(pathname: string): ModuleKey | null {
  const match = MODULES.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`));
  return match?.key ?? null;
}
