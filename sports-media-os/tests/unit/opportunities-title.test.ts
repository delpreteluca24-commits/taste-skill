import { describe, expect, it } from "vitest";

import { opportunityTitle } from "@/lib/opportunities/title";

describe("opportunityTitle", () => {
  it("replaces a heuristic name label with the newest headline", () => {
    expect(opportunityTitle("Futsal · KINTO · Serie", "Futsal, la KINTO Serie A riparte  con il derby")).toBe("Futsal, la KINTO Serie A riparte con il derby");
  });

  it("keeps AI or hand-written trend titles, and labels without a usable headline", () => {
    expect(opportunityTitle("Bologna stun Inter 3-0 at San Siro", "Another headline about the match")).toBe("Bologna stun Inter 3-0 at San Siro");
    expect(opportunityTitle("Sinner · Alcaraz", null)).toBe("Sinner · Alcaraz");
    expect(opportunityTitle("Sinner · Alcaraz", "Short")).toBe("Sinner · Alcaraz");
  });

  it("shortens very long headlines on a word boundary", () => {
    const out = opportunityTitle("A · B", `${"word ".repeat(60)}end`);
    expect(out.length).toBeLessThanOrEqual(158);
    expect(out.endsWith("word…")).toBe(true);
  });
});
