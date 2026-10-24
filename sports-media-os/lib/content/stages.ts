/** Kanban order (M2 spec). The Postgres enum order differs; UI order lives here. */
export const CONTENT_STAGE_ORDER = [
  "idea",
  "research",
  "script",
  "review",
  "production",
  "ready",
  "scheduled",
  "published",
  "analyzing",
] as const;

export type ContentStage = (typeof CONTENT_STAGE_ORDER)[number];

export const STAGE_LABELS: Record<ContentStage, string> = {
  idea: "Idea",
  research: "Research",
  script: "Script",
  review: "Review",
  production: "Production",
  ready: "Ready",
  scheduled: "Scheduled",
  published: "Published",
  analyzing: "Analyzing",
};
