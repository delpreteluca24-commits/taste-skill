import { describe, expect, it, vi } from "vitest";

import { createAIRouter } from "@/lib/ai/router";
import { AIError, type AICallResult, type AIProvider, type TaskModelConfig, type UsageEvent } from "@/lib/ai/types";
import { aggregateProfiles, profileSource } from "@/lib/trends/cluster";
import { findUngroundedTerms, heuristicTitle, labelClusters, validateLabels, type LabelCluster } from "@/lib/trends/labels";
import { MAX_CLUSTERS_PER_CALL, TREND_LABEL_SYSTEM, trendLabelOutputSchema } from "@/prompts/discovery/trend-label";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const CLUSTERS: LabelCluster[] = [
  {
    key: T1,
    headlines: [
      { id: S1, title: "Bologna stun Inter 3-0 at San Siro", publisher: "Example Sport" },
      { id: S2, title: "Clamoroso a San Siro: il Bologna travolge l'Inter 3-0", publisher: "Esempio" },
    ],
  },
  { key: T2, headlines: [{ id: S3, title: "Sinner withdraws from Paris Masters with injury", publisher: "Tennis Daily" }] },
];

const usage = { inputTokens: 800, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 };
const config = (): TaskModelConfig => ({
  task: "discovery",
  primary: { provider: "anthropic", model: "claude-haiku-5-5" },
  fallbacks: [],
  effort: "low",
  maxOutputTokens: 4000,
  source: "default",
});

function fakeRouter(behaviour: () => AICallResult | Promise<AICallResult>, configured = true) {
  const complete = vi.fn(async () => behaviour());
  const provider: AIProvider = { id: "anthropic", isConfigured: () => configured, complete };
  const events: UsageEvent[] = [];
  const router = createAIRouter({ providers: { anthropic: provider }, resolveConfig: config, onUsage: (e) => void events.push(e) });
  return { router, complete, events };
}
const reply = (data: unknown): AICallResult => ({ text: JSON.stringify(data), usage, servedModel: "claude-haiku-5-5", latencyMs: 4, stopReason: "end_turn" });

describe("grounding check — names and numbers must come from the headlines", () => {
  const headlines = CLUSTERS[0].headlines.map((h) => h.title);

  it("accepts labels made of headline names, numbers and ordinary words", () => {
    expect(findUngroundedTerms("Bologna beat Inter 3-0 at San Siro", headlines)).toEqual([]);
    expect(findUngroundedTerms("Inter: Bologna win reaction", headlines)).toEqual([]);
  });

  it("flags invented names, teams and scores", () => {
    expect(findUngroundedTerms("Bologna beat Inter 4-0", headlines)).toEqual(["4-0"]);
    expect(findUngroundedTerms("Lautaro misses as Bologna beat Inter", headlines)).toEqual(["Lautaro"]);
    expect(findUngroundedTerms("Bologna beat Inter in Serie A", headlines)).toEqual(["Serie"]);
  });

  it("checks sentence starts too: only ordinary label words are exempt", () => {
    expect(findUngroundedTerms("Reports say Bologna won at San Siro. Two outlets agree.", headlines)).toEqual([]);
    expect(findUngroundedTerms("Pundits report Bologna won.", headlines)).toEqual(["Pundits"]);
    expect(findUngroundedTerms("Headlines report the result. Lautaro missed.", headlines)).toEqual(["Lautaro"]);
  });
});

describe("validateLabels", () => {
  it("accepts a grounded label citing ids of its own cluster", () => {
    const { accepted, rejected } = validateLabels(
      { labels: [{ cluster: T1, title: "Bologna beat Inter 3-0 at San Siro", description: "Two outlets report the result.", source_ids: [S1, S2] }] },
      CLUSTERS,
    );
    expect(rejected).toEqual([]);
    expect(accepted.get(T1)).toEqual({ title: "Bologna beat Inter 3-0 at San Siro", description: "Two outlets report the result.", sourceIds: [S1, S2] });
  });

  it("rejects unknown clusters, foreign source ids, duplicates and ungrounded labels", () => {
    const { accepted, rejected } = validateLabels(
      {
        labels: [
          { cluster: "not-a-cluster", title: "Anything", source_ids: [S1] },
          { cluster: T1, title: "Bologna beat Inter", source_ids: [S3] }, // S3 belongs to T2
          { cluster: T2, title: "Sinner out of Paris after Djokovic clash", source_ids: [S3] },
        ],
      },
      CLUSTERS,
    );
    expect(accepted.size).toBe(0);
    expect(rejected.map((r) => r.reason)).toEqual([
      "unknown cluster key",
      "cites 1 source id(s) not in this cluster",
      "not in the headlines: Djokovic",
    ]);

    const dup = validateLabels(
      {
        labels: [
          { cluster: T2, title: "Sinner withdraws from Paris", source_ids: [S3] },
          { cluster: T2, title: "Sinner injury", source_ids: [S3] },
        ],
      },
      CLUSTERS,
    );
    expect(dup.accepted.get(T2)?.title).toBe("Sinner withdraws from Paris");
    expect(dup.rejected).toEqual([{ key: T2, reason: "duplicate label for the same cluster" }]);
  });
});

describe("labelClusters — DISCOVERY task through the router (fake provider)", () => {
  it("one call for the batch; validated labels and the ledger entry", async () => {
    const { router, complete, events } = fakeRouter(() =>
      reply({
        labels: [
          { cluster: T1, title: "Bologna beat Inter 3-0 at San Siro", description: "Headlines report the result.", source_ids: [S1] },
          { cluster: T2, title: "Sinner withdraws from Paris Masters", description: null, source_ids: [S3] },
        ],
      }),
    );
    const out = await labelClusters(router, CLUSTERS);
    expect(out.status).toBe("labelled");
    expect([...out.accepted.keys()]).toEqual([T1, T2]);
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0] as unknown as [string, { system: string; messages: { content: string }[]; cacheSystemPrompt: boolean }];
    expect(request[1].system).toBe(TREND_LABEL_SYSTEM);
    expect(request[1].cacheSystemPrompt).toBe(true);
    // only the headlines and ids we hold go to the model
    expect(request[1].messages[0].content).toContain(S1);
    expect(request[1].messages[0].content).toContain("Bologna stun Inter 3-0 at San Siro");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ task: "discovery", status: "success" });
  });

  it("not configured → no call, heuristic titles stay", async () => {
    const { router, complete } = fakeRouter(() => reply({ labels: [] }), false);
    const out = await labelClusters(router, CLUSTERS);
    expect(out.status).toBe("not_configured");
    expect(out.accepted.size).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it("model failure or invalid output never throws", async () => {
    const down = fakeRouter(() => {
      throw new AIError("overloaded", "529");
    });
    expect((await labelClusters(down.router, CLUSTERS)).status).toBe("failed");
    const garbage = fakeRouter(() => ({ ...reply({}), text: "no json here" }));
    expect((await labelClusters(garbage.router, CLUSTERS)).status).toBe("failed");
  });

  it("skips the call when there is nothing to label and caps the batch size", async () => {
    const { router, complete } = fakeRouter(() => reply({ labels: [] }));
    expect((await labelClusters(router, [])).status).toBe("skipped");
    const many = Array.from({ length: MAX_CLUSTERS_PER_CALL + 5 }, (_, i) => ({
      key: `k${i}`,
      headlines: [{ id: `h${i}`, title: `Headline ${i}`, publisher: null }],
    }));
    await labelClusters(router, many);
    const content = (complete.mock.calls[0] as unknown as [string, { messages: { content: string }[] }])[1].messages[0].content;
    expect(content).toContain(`"k${MAX_CLUSTERS_PER_CALL - 1}"`);
    expect(content).not.toContain(`"k${MAX_CLUSTERS_PER_CALL}"`);
  });

  it("output schema refuses labels without a source", () => {
    expect(trendLabelOutputSchema.safeParse({ labels: [{ cluster: T1, title: "Bologna beat Inter", source_ids: [] }] }).success).toBe(false);
  });
});

describe("heuristicTitle", () => {
  it("joins the most shared names (no name repeated inside a longer one)", () => {
    const agg = aggregateProfiles(
      ["Jannik Sinner beats Carlos Alcaraz in Shanghai final", "Sinner downs Alcaraz to win Shanghai Masters title", "Shanghai Masters: Sinner stuns Alcaraz"].map(
        (t) => profileSource({ title: t, summary: null }),
      ),
    );
    expect(heuristicTitle(agg, "Shanghai Masters: Sinner stuns Alcaraz")).toBe("Shanghai Masters · Alcaraz · Sinner");
  });

  it("falls back to the newest headline, then to keywords", () => {
    const one = aggregateProfiles([profileSource({ title: "Record crowd expected for the final", summary: null })]);
    expect(heuristicTitle(one, "Record crowd expected for the final")).toBe("Record crowd expected for the final");
    expect(heuristicTitle({ entities: [], keywords: ["referee", "strike"] }, null)).toBe("referee · strike");
    expect(heuristicTitle({ entities: [], keywords: [] }, null)).toBe("Untitled story");
  });
});
