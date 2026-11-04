import { describe, expect, it, vi } from "vitest";

const createFromTrend = vi.fn();
vi.mock("@/lib/opportunities/service", () => ({ createFromTrend }));
vi.mock("@/lib/trends/service", () => ({ detectTrends: vi.fn(), detectionRunningAhead: vi.fn() }));

const { AUTO_PROMOTE, promoteTopTrends } = await import("@/workers/handlers/trends-detect");

type Call = { table: string; ops: string[] };

/** chainable query fake: every builder call is recorded, awaiting resolves via `answer` */
function fakeDb(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer(call)).then(ok, ko),
      };
      for (const op of ["select", "eq", "in", "gte", "order", "limit", "contains", "not", "update"])
        builder[op] = (...args: unknown[]) => (call.ops.push(`${op}:${JSON.stringify(args)}`), builder);
      return builder;
    },
  };
  return { db: db as never, calls };
}

const trends = [
  { id: "t1", title: "A", radar_score: 80 },
  { id: "t2", title: "B", radar_score: 70 },
  { id: "t3", title: "C", radar_score: 60 },
];

function setup(opts: { today?: number; taken?: string[] }) {
  return fakeDb((c) => {
    if (c.table === "trends") return { data: trends };
    if (c.ops.some((o) => o.startsWith("update"))) return { error: null };
    if (c.ops.some((o) => o.startsWith("contains"))) return { count: opts.today ?? 0 };
    return { data: (opts.taken ?? []).map((trend_id) => ({ trend_id })) };
  });
}

describe("promoteTopTrends", () => {
  it("promotes fresh strong trends that have no opportunity yet, marking them auto_promoted", async () => {
    createFromTrend.mockReset().mockImplementation(async (_db, a) => ({ data: { id: `o-${a.trendId}`, existing: false }, error: null }));
    const { db, calls } = setup({ taken: ["t2"] });
    const activity = vi.fn();
    const ids = await promoteTopTrends({ db, projectId: "p", activity });
    expect(ids).toEqual(["o-t1", "o-t3"]);
    expect(createFromTrend).toHaveBeenCalledWith(db, { projectId: "p", trendId: "t1", userId: null });
    expect(calls.filter((c) => c.ops.some((o) => o.includes('"auto_promoted":true') && o.startsWith("update")))).toHaveLength(2);
    expect(activity).toHaveBeenCalledTimes(2);
  });

  it("respects the daily budget", async () => {
    createFromTrend.mockReset().mockImplementation(async (_db, a) => ({ data: { id: `o-${a.trendId}`, existing: false }, error: null }));
    const { db } = setup({ today: AUTO_PROMOTE.perDay - 1 });
    expect(await promoteTopTrends({ db, projectId: "p", activity: vi.fn() })).toEqual(["o-t1"]);
    const full = setup({ today: AUTO_PROMOTE.perDay });
    createFromTrend.mockClear();
    expect(await promoteTopTrends({ db: full.db, projectId: "p", activity: vi.fn() })).toEqual([]);
    expect(createFromTrend).not.toHaveBeenCalled();
  });

  it("skips failures and opportunities that already existed", async () => {
    createFromTrend
      .mockReset()
      .mockResolvedValueOnce({ data: null, error: { code: "x" } })
      .mockResolvedValueOnce({ data: { id: "o-t2", existing: true }, error: null })
      .mockResolvedValueOnce({ data: { id: "o-t3", existing: false }, error: null });
    const { db } = setup({});
    expect(await promoteTopTrends({ db, projectId: "p", activity: vi.fn() })).toEqual(["o-t3"]);
  });
});
