/**
 * A heuristic trend label ("Sinner · Alcaraz · Shanghai") names the cluster,
 * not the story; an opportunity reads better as the newest real headline.
 * AI-written (or hand-edited) trend titles are kept as they are.
 */
export function opportunityTitle(trendTitle: string, newestHeadline: string | null): string {
  const headline = newestHeadline?.replace(/\s+/g, " ").trim();
  if (!trendTitle.includes(" · ") || !headline || headline.length < 12) return trendTitle;
  return headline.length > 160 ? `${headline.slice(0, 157).replace(/\s+\S*$/, "")}…` : headline;
}
