import { describe, expect, it } from "vitest";

import { calibrationVerdict, spearman } from "@/lib/publishing/learning";

describe("spearman", () => {
  it("is 1 for the same order and -1 for the reverse", () => {
    const up = [1, 2, 3, 4].map((x) => ({ predicted: x, actual: x * 10 }));
    expect(spearman(up)).toBe(1);
    expect(spearman(up.map((p) => ({ ...p, actual: -p.actual })))).toBe(-1);
  });
  it("needs at least 3 pairs and some variation", () => {
    expect(spearman([{ predicted: 1, actual: 1 }, { predicted: 2, actual: 2 }])).toBeNull();
    expect(spearman([1, 2, 3].map((x) => ({ predicted: 5, actual: x })))).toBeNull();
  });
  it("averages ties", () => {
    expect(spearman([{ predicted: 1, actual: 1 }, { predicted: 1, actual: 2 }, { predicted: 3, actual: 3 }])).toBeCloseTo(0.87, 2);
  });
});

describe("calibrationVerdict", () => {
  it("asks for data first", () => {
    expect(calibrationVerdict(null, 1)).toMatch(/at least 3/);
    expect(calibrationVerdict(0.5, 25)).toMatch(/predicts/);
  });
});
