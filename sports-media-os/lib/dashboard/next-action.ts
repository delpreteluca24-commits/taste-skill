import type { DashboardData } from "./types";

export type NextAction = {
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

/**
 * The single most useful thing to do now, derived from real dashboard data.
 * Later pipeline stages win: finishing work beats starting new work.
 */
export function nextBestAction(d: DashboardData): NextAction {
  const published = d.published.length;
  const views = d.metrics.views ?? 0;
  if (published > 0 && views === 0) {
    return { step: 5, title: "Log how your published pieces performed", detail: `${published} published piece(s) have no metrics yet. Add views and retention to close the learning loop.`, href: "/analytics", cta: "Open Analytics" };
  }
  if (d.ready_to_publish.length > 0) {
    return { step: 4, title: "Schedule what is ready", detail: `${d.ready_to_publish.length} piece(s) passed fact and rights checks. Give each one a slot.`, href: "/calendar", cta: "Open Calendar" };
  }
  if (d.content_in_production.length > 0) {
    return { step: 3, title: "Finish the pieces in production", detail: `${d.content_in_production.length} piece(s) need a script, a hook or a review.`, href: "/content", cta: "Open Pipeline" };
  }
  const approved = d.top_opportunities.filter((o) => o.status === "approved").length;
  if (approved > 0) {
    return { step: 2, title: "Start production on approved opportunities", detail: `${approved} approved opportunit${approved === 1 ? "y is" : "ies are"} waiting for research and a script.`, href: "/opportunities?status=approved", cta: "Start production" };
  }
  const fresh = d.top_opportunities.filter((o) => o.status === "new" || o.status === "researching").length;
  if (fresh > 0) {
    return { step: 1, title: "Pick today's best opportunity", detail: `${fresh} scored opportunit${fresh === 1 ? "y" : "ies"} to review. Approve only S/A-tier.`, href: "/opportunities", cta: "Review opportunities" };
  }
  if (d.trending_stories.length > 0) {
    return { step: 1, title: "Turn a trend into an opportunity", detail: `${d.trending_stories.length} story signal(s) are rising. Promote the best one.`, href: "/trends", cta: "Open Trends" };
  }
  return { step: 1, title: "Connect your first sources", detail: "Add 3–5 RSS feeds from outlets and official sites. The radar turns them into trends and scored opportunities.", href: "/radar/connectors", cta: "Add sources" };
}
