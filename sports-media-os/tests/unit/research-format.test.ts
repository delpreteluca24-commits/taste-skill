import { describe, expect, it } from "vitest";

import { dateInputProps, dateTimeAttr, formatResearchDate } from "@/lib/research/format";
import { parseDateInput } from "@/lib/research/schema";

describe("research dates", () => {
  it("shows date-only values as a day and timed values with an explicit UTC", () => {
    expect(formatResearchDate("2026-10-04T00:00:00.000Z")).toBe("4 Oct 2026");
    expect(formatResearchDate("2026-10-04T20:45:00.000Z")).toBe("4 Oct 2026, 20:45 UTC");
    expect(formatResearchDate(null)).toBe("—");
    expect(formatResearchDate("not a date")).toBe("—");
    expect(dateTimeAttr("2026-10-04T20:45:00+02:00")).toBe("2026-10-04T18:45:00.000Z");
    expect(dateTimeAttr(undefined)).toBeUndefined();
  });

  it("edits a stored date without losing precision, and the form reads it back to the same instant", () => {
    const day = dateInputProps("2026-10-04T00:00:00.000Z");
    expect(day).toEqual({ type: "date", defaultValue: "2026-10-04" });
    expect(parseDateInput(day.defaultValue)).toBe("2026-10-04T00:00:00.000Z");

    const timed = dateInputProps("2026-10-04T20:45:00.000Z");
    expect(timed).toEqual({ type: "datetime-local", defaultValue: "2026-10-04T20:45" });
    expect(parseDateInput(timed.defaultValue)).toBe("2026-10-04T20:45:00.000Z");

    expect(dateInputProps(null)).toEqual({ type: "date", defaultValue: "" });
  });
});
