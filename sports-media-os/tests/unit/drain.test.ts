import { describe, expect, it, vi } from "vitest";

const pollOnce = vi.fn();
vi.mock("@/workers/runner", () => ({ pollOnce, scheduleDueConnectors: vi.fn(async () => 1) }));

const { drainJobs } = await import("@/workers/drain");
const db = { rpc: vi.fn(async () => ({ data: 0 })) } as never;

describe("drainJobs", () => {
  it("runs until the queue is empty", async () => {
    pollOnce.mockReset().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await drainJobs(db, {}, "w", { budgetMs: 10_000 })).toEqual({ ran: 3, scheduled: 1 });
  });

  it("stops when the time budget is spent", async () => {
    pollOnce.mockReset().mockResolvedValue(1);
    expect((await drainJobs(db, {}, "w", { budgetMs: 0 })).ran).toBe(0);
  });
});
