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
  | "studio"
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
  group: "home" | "discover" | "verify" | "produce" | "publish" | "learn" | "system";
};

export const MODULES: readonly ModuleDefinition[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", group: "home", milestone: 1,
    description: "Your next best action, what is in production and what is performing." },
  { key: "radar", href: "/radar", label: "Sports Radar", group: "discover", milestone: 2,
    description: "Sports, events, latest news and emerging stories, ranked by priority." },
  { key: "trends", href: "/trends", label: "Trends", group: "discover", milestone: 2,
    description: "Signals normalized from connected sources: Source → Trend → Opportunity." },
  { key: "opportunities", href: "/opportunities", label: "Opportunities", group: "discover", milestone: 2,
    description: "Scored content opportunities with why-now, angle, hook and explained score." },
  { key: "research", href: "/research", label: "Research", group: "verify", milestone: 2,
    description: "Research workspace per opportunity: sources, claims, timeline, quotes, media, competitors, questions." },
  { key: "rights", href: "/rights", label: "Rights Center", group: "verify", milestone: 2,
    description: "Rights-first asset classification (GREEN / YELLOW / RED) and usage approvals." },
  { key: "content", href: "/content", label: "Pipeline", group: "produce", milestone: 2,
    description: "Kanban from idea to analyzing, with Script Studio and Hook Studio." },
  { key: "studio", href: "/studio", label: "Studio", group: "produce", milestone: 5,
    description: "Production package per piece: script, hook, verified facts, titles, thumbnail brief, export." },
  { key: "calendar", href: "/calendar", label: "Calendar", group: "publish", milestone: 5,
    description: "Plan and track publishing across YouTube, TikTok and Instagram." },
  { key: "analytics", href: "/analytics", label: "Analytics", group: "learn", milestone: 5,
    description: "Real performance vs predicted score — the learning loop." },
  { key: "agents", href: "/agents", label: "Agents", group: "learn", milestone: 5,
    description: "What the AI agents did, what it cost and what failed." },
  { key: "settings", href: "/settings", label: "Settings", group: "system", milestone: 1,
    description: "AI provider, defaults, thresholds, publishing and connections." },
] as const;

/** Sidebar groups follow the editorial workflow; `step` numbers the path. */
export const NAV_GROUPS: { key: ModuleDefinition["group"]; label: string; step?: number }[] = [
  { key: "home", label: "Home" },
  { key: "discover", label: "Discover", step: 1 },
  { key: "verify", label: "Verify", step: 2 },
  { key: "produce", label: "Produce", step: 3 },
  { key: "publish", label: "Publish", step: 4 },
  { key: "learn", label: "Learn", step: 5 },
  { key: "system", label: "System" },
];

/** Milestone currently delivered — modules above it render their roadmap placeholder. */
export const CURRENT_MILESTONE = 5;

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
