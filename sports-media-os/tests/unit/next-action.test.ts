import { describe, expect, it } from "vitest";

import { nextBestAction } from "@/lib/dashboard/next-action";
import type { DashboardData } from "@/lib/dashboard/types";

const empty = {
  metrics: { views: 0 },
  published: [],
  ready_to_publish: [],
  content_in_production: [],
  top_opportunities: [],
  trending_stories: [],
} as unknown as DashboardData;

describe("nextBestAction", () => {
  it("starts with sources on an empty project", () => {
    expect(nextBestAction(empty)).toMatchObject({ step: 1, href: "/radar/connectors" });
  });

  it("prefers finishing work over starting new work", () => {
    const d = { ...empty, top_opportunities: [{ status: "new" }], content_in_production: [{}] } as unknown as DashboardData;
    expect(nextBestAction(d)).toMatchObject({ step: 3, href: "/content" });
  });

  it("asks for metrics once something is published without views", () => {
    const d = { ...empty, published: [{}], ready_to_publish: [{}] } as unknown as DashboardData;
    expect(nextBestAction(d).step).toBe(5);
  });

  it("routes approved opportunities to production", () => {
    const d = { ...empty, top_opportunities: [{ status: "approved" }] } as unknown as DashboardData;
    expect(nextBestAction(d).step).toBe(2);
  });
});
