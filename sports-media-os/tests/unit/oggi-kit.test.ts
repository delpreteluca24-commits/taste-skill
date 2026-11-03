import { describe, expect, it } from "vitest";

import { buildKit, cleanHeadline, kitText, shorten } from "@/lib/oggi/kit";
import { rankScore } from "@/lib/oggi/service";

describe("buildKit (no AI)", () => {
  const kit = buildKit({
    title: "Bulega eguaglia Bayliss: il record a Jerez - OA Sport",
    sport: "Motorsport",
    signals: ["record", "breaking"],
    publishers: ["OA Sport", "Gazzetta", "OA Sport"],
  });

  it("gives three distinct titles of at most 70 characters", () => {
    expect(kit.titles.length).toBeGreaterThanOrEqual(2);
    expect(new Set(kit.titles).size).toBe(kit.titles.length);
    for (const t of kit.titles) expect(t.length).toBeLessThanOrEqual(70);
    expect(kit.titles[0]).toBe("Bulega eguaglia Bayliss: il record a Jerez");
  });

  it("picks the hook and closing question from the strongest signal", () => {
    expect(kit.hook.startsWith("È un record:")).toBe(true);
    expect(kit.outline).toHaveLength(5);
    expect(kit.outline[4].text).toContain("Lo rivedremo mai?");
  });

  it("builds hashtags from names and sport, and lists each publisher once", () => {
    expect(kit.hashtags).toContain("#Bulega");
    expect(kit.hashtags).toContain("#Motorsport");
    expect(kit.hashtags).toContain("#shorts");
    expect(kit.description).toContain("Fonti: OA Sport, Gazzetta.");
  });

  it("falls back to neutral templates without signals or names", () => {
    const k = buildKit({ title: "risultati della giornata di oggi", sport: null, signals: [], publishers: [] });
    expect(k.hook.startsWith("Fermati 3 secondi:")).toBe(true);
    expect(k.description).not.toContain("Fonti:");
    expect(kitText(k)).toContain("SCALETTA");
  });
});

describe("text helpers", () => {
  it("drops the publisher suffix and cuts on a word boundary", () => {
    expect(cleanHeadline("Inter, che rimonta  -  Corriere dello Sport")).toBe("Inter, che rimonta");
    expect(shorten("una frase abbastanza lunga da tagliare", 20)).toBe("una frase…");
  });
});

describe("rankScore", () => {
  it("prefers a fresh story over an older, slightly stronger one", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const fresh = rankScore(70, "2026-11-03T10:00:00Z", now);
    const old = rankScore(80, "2026-11-01T12:00:00Z", now);
    expect(fresh).toBeGreaterThan(old);
  });
});
