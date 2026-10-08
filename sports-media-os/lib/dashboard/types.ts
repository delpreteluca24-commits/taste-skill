import { z } from "zod";

/**
 * Runtime contract for the `get_dashboard` RPC payload
 * (supabase/migrations/*_dashboard.sql). Parsing keeps the UI safe if the SQL
 * and the TS drift apart: bad sections degrade to empty, never crash the page.
 */
const num = z.coerce.number();
// null stays null (missing data must not render as 0); Postgres numerics arrive as strings
const nullableNum = z
  .preprocess((v) => (v === null || v === undefined || v === "" ? null : Number(v)), z.number().nullable())
  .catch(null);
const ts = z.string();

const opportunityRow = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.string(),
  opportunity_score: nullableNum,
  competition: z.string().nullable().catch(null),
  why_now: z.string().nullable().optional(),
  created_at: ts,
});

const trendRow = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.string(),
  trend_score: nullableNum,
  keywords: z.array(z.string()).catch([]),
  last_seen_at: ts,
});

const contentRow = z.object({
  id: z.uuid(),
  title: z.string(),
  stage: z.string(),
  format: z.string().optional(),
  stage_changed_at: ts.optional(),
  scheduled_at: ts.nullable().optional(),
  published_at: ts.nullable().optional(),
  target_platforms: z.array(z.string()).optional(),
});

const performingRow = z.object({
  id: z.uuid(),
  title: z.string(),
  predicted_score: nullableNum,
  published_at: ts.nullable(),
  views: nullableNum,
  likes: nullableNum,
  shares: nullableNum,
});

const agentStatusRow = z.object({
  agent: z.string(),
  status: z.string(),
  started_at: ts.nullable(),
  finished_at: ts.nullable(),
  error_message: z.string().nullable(),
  created_at: ts,
  failures_24h: num,
});

const performanceDay = z.object({ day: z.string(), published: num, views: num });

const list = <T extends z.ZodType>(item: T) => z.array(item).catch([]);

export const dashboardSchema = z.object({
  generated_at: ts,
  timezone: z.string(),
  metrics: z.object({
    views: num.catch(0),
    clips_created: num.catch(0),
    content_published: num.catch(0),
    top_opportunity_score: nullableNum,
    avg_virality_score: nullableNum,
    production_queue: num.catch(0),
  }),
  pipeline: z.record(z.string(), num).catch({}),
  todays_opportunities: list(opportunityRow),
  top_opportunities: list(opportunityRow),
  trending_stories: list(trendRow),
  content_in_production: list(contentRow),
  ready_to_publish: list(contentRow),
  published: list(contentRow),
  performing_content: list(performingRow),
  agent_status: list(agentStatusRow),
  recent_performance: list(performanceDay),
});

export type DashboardData = z.infer<typeof dashboardSchema>;
export type OpportunityRow = z.infer<typeof opportunityRow>;
export type TrendRow = z.infer<typeof trendRow>;
export type ContentRow = z.infer<typeof contentRow>;
export type PerformanceDay = z.infer<typeof performanceDay>;
export type AgentStatusRow = z.infer<typeof agentStatusRow>;
