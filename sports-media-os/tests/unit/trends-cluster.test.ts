import { describe, expect, it } from "vitest";

import {
  aggregateProfiles,
  clusterDocuments,
  compareProfiles,
  extractEntities,
  jaccard,
  keywordsOf,
  majoritySport,
  matchEvent,
  matchTrend,
  profileSource,
  SAME_STORY,
  stem,
  tokenize,
  type ClusterDoc,
} from "@/lib/trends/cluster";

const profile = (title: string, summary: string | null = null) => profileSource({ title, summary });

/** realistic EN/IT headlines: 3 stories + noise */
const HEADLINES: [id: string, title: string][] = [
  ["s1", "Jannik Sinner beats Carlos Alcaraz in Shanghai final"],
  ["s2", "Sinner downs Alcaraz to win Shanghai Masters title"],
  ["s3", "Shanghai Masters: Sinner stuns Alcaraz in three sets"],
  ["s4", "Sinner withdraws from Paris Masters with injury"],
  ["b1", "Bologna stun Inter 3-0 at San Siro"],
  ["b2", "Inter beaten 3-0 by Bologna in shock home defeat"],
  ["b3", "Clamoroso a San Siro: il Bologna travolge l'Inter 3-0"],
  ["b4", "Bologna Stun Inter In Shock Win At San Siro"],
  ["i1", "Inter, Inzaghi: «Serata storta, chiediamo scusa ai tifosi»"],
  ["n1", "Napoli beat Lazio 2-1"],
  ["n2", "Roma beat Genoa 2-1"],
];

const docs = (order: [string, string][] = HEADLINES): ClusterDoc[] =>
  order.map(([id, title]) => ({ id, time: Date.parse("2026-10-08T10:00:00Z") + Number(HEADLINES.findIndex((h) => h[0] === id)) * 60_000, profile: profile(title) }));

const normalize = (clusters: string[][]) => clusters.map((c) => [...c].sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

describe("tokenization, stopwords and keywords (EN + IT)", () => {
  it("normalizes accents/apostrophes and keeps scorelines as one token", () => {
    expect(tokenize("Città, l’Inter vince 3-0!")).toEqual(["citta", "l", "inter", "vince", "3-0"]);
  });

  it("drops EN/IT stopwords and generic sports words, stems lightly", () => {
    expect(keywordsOf("The coach says the goals of the season")).toEqual(["goal"]);
    expect(keywordsOf("Il tecnico della squadra e i giocatori")).toEqual([]);
    expect(stem("injuries")).toBe("injury");
    expect(stem("infortunio")).toBe(stem("infortuni"));
    expect(stem("squadra")).toBe(stem("squadre"));
    expect(stem("3-0")).toBe("3-0");
  });

  it("extracts capitalized names, joined across particles, split at punctuation", () => {
    const keys = (t: string) => extractEntities(t).map((e) => e.key);
    expect(keys("Jannik Sinner beats Carlos Alcaraz in Shanghai")).toEqual(["jannik sinner", "carlos alcaraz", "shanghai"]);
    expect(keys("Kevin De Bruyne returns, Manchester City relieved")).toEqual(["kevin de bruyne", "manchester city"]);
    expect(keys("Clamoroso a San Siro: il Bologna travolge l'Inter")).toEqual(["clamoroso", "san siro", "bologna", "inter"]);
    // title case: every word is capitalized, so each word is its own candidate
    expect(keys("Bologna Stun Inter In Shock Win")).toEqual(["bologna", "stun", "inter", "shock"]);
    // generic words never become names
    expect(keys("Breaking News: Official Statement")).toEqual(["statement"]);
  });

  it("competition words describe the context, not the story (not entity terms)", () => {
    expect(profile("Sinner withdraws from Paris Masters").entityTerms).toEqual(["sinner", "paris"]);
  });
});

describe("same-story rules (documented thresholds)", () => {
  it("exposes the thresholds", () => {
    expect(SAME_STORY).toEqual({ strongEntityTerms: 2, strongKeywordJaccard: 0.1, entityKeywordJaccard: 0.25, keywordOnlyJaccard: 0.4 });
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
  });

  it("rule (a): two shared names and some shared words", () => {
    const c = compareProfiles(profile(HEADLINES[0][1]), profile(HEADLINES[1][1]));
    expect(c.rule).toBe("a");
    expect(c.sharedEntityTerms).toEqual(["alcaraz", "shanghai", "sinner"]);
  });

  it("rule (b): one shared name needs keyword Jaccard ≥ 0.25", () => {
    const a = { keywords: ["sinner", "win", "shangh", "final"], entityTerms: ["sinner"] };
    const b = { keywords: ["sinner", "win", "shangh", "title"], entityTerms: ["sinner"] };
    expect(compareProfiles(a, b)).toMatchObject({ rule: "b", keywordJaccard: 0.6 });
    const c = { keywords: ["sinner", "withdraw", "pari", "injury"], entityTerms: ["sinner"] };
    expect(compareProfiles(a, c).rule).toBeNull();
  });

  it("rule (c): no names, keyword Jaccard ≥ 0.40", () => {
    const a = { keywords: ["referee", "strike", "weekend", "fixture"], entityTerms: [] };
    const b = { keywords: ["referee", "strike", "weekend", "postponed"], entityTerms: [] };
    expect(compareProfiles(a, b)).toMatchObject({ rule: "c", keywordJaccard: 0.6 });
    expect(compareProfiles(a, { keywords: ["referee", "pay"], entityTerms: [] }).rule).toBeNull();
  });

  it("a shared name alone is never the same story", () => {
    expect(compareProfiles(profile("Sinner wins Shanghai Masters title"), profile("Sinner withdraws from Paris Masters with injury")).rule).toBeNull();
    expect(compareProfiles(profile("Napoli beat Lazio 2-1"), profile("Roma beat Genoa 2-1")).rule).toBeNull();
  });
});

describe("clusterDocuments", () => {
  it("groups headlines of the same story across languages and styles", () => {
    expect(normalize(clusterDocuments(docs()))).toEqual(normalize([["s1", "s2", "s3"], ["s4"], ["b1", "b2", "b3", "b4"], ["i1"], ["n1"], ["n2"]]));
  });

  it("is deterministic: any input order gives the same clusters", () => {
    const expected = clusterDocuments(docs());
    const reversed = clusterDocuments(docs([...HEADLINES].reverse()));
    const shuffled = clusterDocuments(docs([HEADLINES[5], HEADLINES[0], HEADLINES[9], HEADLINES[3], HEADLINES[7], HEADLINES[1], HEADLINES[10], HEADLINES[2], HEADLINES[8], HEADLINES[4], HEADLINES[6]]));
    expect(reversed).toEqual(expected);
    expect(shuffled).toEqual(expected);
  });

  it("orders members chronologically (ties broken by id)", () => {
    const p = profile("Bologna stun Inter 3-0 at San Siro");
    const out = clusterDocuments([
      { id: "z", time: 5, profile: p },
      { id: "a", time: 5, profile: p },
      { id: "m", time: 1, profile: p },
    ]);
    expect(out).toEqual([["m", "a", "z"]]);
  });
});

describe("aggregate profiles and trend matching", () => {
  const story = ["s1", "s2", "s3"].map((id) => profile(HEADLINES.find((h) => h[0] === id)![1]));

  it("aggregates the most shared words and names (ties alphabetical)", () => {
    const agg = aggregateProfiles(story);
    expect(agg.keywords.slice(0, 3)).toEqual(["alcaraz", "shangh", "sinner"]);
    expect(agg.entityTerms.slice(0, 3)).toEqual(["alcaraz", "shanghai", "sinner"]);
    expect(agg.entities[0]).toMatchObject({ display: "Shanghai Masters", sources: 2 });
  });

  it("matches a new cluster to the existing trend by keyword/name overlap", () => {
    const agg = aggregateProfiles([profile("Alcaraz on Shanghai final loss to Sinner: 'he was better'")]);
    const trends = [
      { id: "t-inter", keywords: ["bologn", "inter", "3-0"], entityTerms: ["bologna", "inter"] },
      { id: "t-sinner", ...aggregateProfiles(story) },
    ];
    expect(matchTrend(agg, trends)?.trendId).toBe("t-sinner");
    expect(matchTrend(aggregateProfiles([profile("Roma beat Genoa 2-1")]), trends)).toBeNull();
  });

  it("majority sport needs 2/3 of the sources that have one", () => {
    expect(majoritySport(["f", "f", "t", null])).toBe("f");
    expect(majoritySport(["f", "t"])).toBeNull();
    expect(majoritySport([null, null])).toBeNull();
  });
});

describe("matchEvent — link only when obvious", () => {
  const cluster = aggregateProfiles([profile("Bologna stun Inter 3-0 at San Siro"), profile("Inter beaten by Bologna")]);
  const ref = Date.parse("2026-10-08T22:00:00Z");
  const ev = (id: string, title: string, startsAt = "2026-10-08T18:45:00Z", status = "finished") => ({ id, title, starts_at: startsAt, status });

  it("links the fixture whose team names appear in the cluster", () => {
    expect(matchEvent(cluster, [ev("e1", "Inter vs Bologna"), ev("e2", "Napoli vs Lazio")], ref)).toEqual({ eventId: "e1", matched: ["inter", "bologn"] });
    expect(matchEvent(cluster, [ev("e1", "Serie A: Inter - Bologna")], ref)?.eventId).toBe("e1");
  });

  it("refuses ambiguous, distant, cancelled or weak matches", () => {
    expect(matchEvent(cluster, [ev("e1", "Inter vs Bologna"), ev("e2", "Bologna vs Inter")], ref)).toBeNull();
    expect(matchEvent(cluster, [ev("e1", "Inter vs Bologna", "2026-10-01T18:45:00Z")], ref)).toBeNull();
    expect(matchEvent(cluster, [ev("e1", "Inter vs Bologna", "2026-10-08T18:45:00Z", "cancelled")], ref)).toBeNull();
    expect(matchEvent(cluster, [ev("e1", "Inter vs Juventus")], ref)).toBeNull();
  });
});
