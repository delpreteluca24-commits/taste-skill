import { describe, expect, it } from "vitest";

import { createProjectSchema, isValidTimezone, slugify } from "@/lib/projects/schema";

describe("slugify", () => {
  it("produces DB-compatible slugs", () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/; // same regex as projects.slug check
    for (const input of ["Football Shorts", "  NBA  Stories!! ", "Calcio & Più", "Ça va — Sport", "a".repeat(200), "---"]) {
      const slug = slugify(input);
      expect(slug).toMatch(pattern);
      expect(slug.length).toBeLessThanOrEqual(60);
    }
  });

  it("strips accents and punctuation", () => {
    expect(slugify("Calcio & Più")).toBe("calcio-piu");
    expect(slugify("NBA Stories")).toBe("nba-stories");
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("project");
    expect(slugify("")).toBe("project");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA zones and rejects garbage", () => {
    expect(isValidTimezone("Europe/Rome")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("createProjectSchema", () => {
  it("applies defaults and trims", () => {
    const parsed = createProjectSchema.parse({ name: "  Football Shorts  " });
    expect(parsed).toMatchObject({ name: "Football Shorts", language: "en", timezone: "UTC" });
    expect(parsed.description).toBeUndefined();
    expect(parsed.primarySportId).toBeUndefined();
  });

  it("treats empty optional strings as missing", () => {
    const parsed = createProjectSchema.parse({ name: "X", description: "  ", primarySportId: "" });
    expect(parsed.description).toBeUndefined();
    expect(parsed.primarySportId).toBeUndefined();
  });

  it("rejects invalid input", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "X", timezone: "Nope/Nope" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "X", language: "english" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "X", primarySportId: "not-a-uuid" }).success).toBe(false);
  });
});
