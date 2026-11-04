import { afterAll, describe, expect, it } from "vitest";

import { normalizeUsageRows, summarizeUsage } from "@/components/settings/ai-usage";

import { createProject, pool, tx, type Db } from "./db";

afterAll(() => pool.end());

/**
 * Settings → AI usage reads public.ai_usage_summary(project, days) with the
 * user's client. The function is SECURITY INVOKER, so the ai_usage RLS policy
 * decides what each caller can aggregate.
 */

const insertUsage = `insert into public.ai_usage
  (project_id, task, provider, model, status, input_tokens, output_tokens, cost_usd, created_at)
  values ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(days => $9))`;

async function seed(db: Db) {
  const owner = await db.createUser();
  const outsider = await db.createUser();
  const viewer = await db.createUser();
  const a = await createProject(db, owner, "Project A");
  const b = await createProject(db, outsider, "Project B");
  await db.as(owner);
  await db.q("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')", [a, viewer]);

  await db.asAdmin(); // the ledger is worker-written (service role)
  const rows: [string | null, string, string, string, string, number, number, number | null, number][] = [
    [a, "scoring", "anthropic", "claude-haiku-5-5", "success", 700, 450, 0.000295, 1],
    [a, "scoring", "anthropic", "claude-haiku-5-5", "error", 0, 0, null, 2],
    [a, "script", "openai", "gpt-test", "success", 1400, 1100, null, 3],
    [a, "research", "anthropic", "claude-sonnet-5-5", "success", 900, 1400, 0.0158, 45], // outside the 30-day window
    [b, "scoring", "anthropic", "claude-opus-5-5", "success", 5000, 5000, 0.12, 1],
    [null, "discovery", "anthropic", "claude-haiku-5-5", "success", 100, 100, 0.00006, 1], // workspace-level call
  ];
  for (const r of rows) await db.q(insertUsage, r);
  return { owner, outsider, viewer, a, b };
}

const summary = (db: Db, project: string, days = 30) =>
  db.q<Record<string, unknown>>("select * from public.ai_usage_summary($1, $2)", [project, days]);

describe("AI usage summary (Settings panel)", () => {
  it("summarises the active project's last 30 days per task/model, unpriced kept as null", () =>
    tx(async (db) => {
      const s = await seed(db);
      await db.as(s.owner);
      const result = summarizeUsage(normalizeUsageRows(await summary(db, s.a)));
      expect(result.lines.map((l) => [l.task, l.model, l.calls, l.errors, l.costState])).toEqual([
        ["scoring", "claude-haiku-5-5", 2, 1, "priced"],
        ["script", "gpt-test", 1, 0, "unpriced"],
      ]);
      expect(result.totals).toMatchObject({ calls: 3, errors: 1, inputTokens: 2100, outputTokens: 1550, costUsd: 0.000295, unpricedCalls: 1 });

      // a wider window includes the older research call
      const wide = normalizeUsageRows(await summary(db, s.a, 60));
      expect(wide.map((r) => r.task).sort()).toEqual(["research", "scoring", "script"]);
    }));

  it("is isolated per project: an outsider passing another project's id gets nothing", () =>
    tx(async (db) => {
      const s = await seed(db);
      await db.as(s.outsider);
      expect(await summary(db, s.a)).toEqual([]);
      const own = normalizeUsageRows(await summary(db, s.b));
      expect(own.map((r) => [r.task, r.model, r.calls])).toEqual([["scoring", "claude-opus-5-5", 1]]);

      await db.as(s.owner);
      expect(await summary(db, s.b)).toEqual([]);
    }));

  it("lets project viewers read usage but never write the ledger", () =>
    tx(async (db) => {
      const s = await seed(db);
      await db.as(s.viewer);
      expect(normalizeUsageRows(await summary(db, s.a))).toHaveLength(2);
      await db.fails(
        "insert into public.ai_usage (project_id, task, provider, model, status) values ($1, 'scoring', 'anthropic', 'claude-haiku-5-5', 'success')",
        [s.a],
        /permission denied/,
      );
      await db.fails("update public.ai_usage set cost_usd = 0 where project_id = $1", [s.a], /permission denied/);
    }));

  it("is not callable anonymously", () =>
    tx(async (db) => {
      const s = await seed(db);
      await db.asAnon();
      await db.fails("select * from public.ai_usage_summary($1, 30)", [s.a], /permission denied/);
    }));
});
