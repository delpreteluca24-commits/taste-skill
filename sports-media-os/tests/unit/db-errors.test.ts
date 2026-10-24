import { describe, expect, it } from "vitest";

import { parseGuardError, toUserMessage } from "@/lib/db/errors";

describe("parseGuardError", () => {
  it("parses business-rule guard errors raised by the database", () => {
    expect(
      parseGuardError({ code: "P0001", message: "CONTENT_NOT_READY: 2 critical fact(s) not confirmed" }),
    ).toEqual({ code: "CONTENT_NOT_READY", detail: "2 critical fact(s) not confirmed" });
  });

  it("ignores other errors and unknown prefixes", () => {
    expect(parseGuardError({ code: "23505", message: "duplicate key" })).toBeNull();
    expect(parseGuardError({ code: "P0001", message: "SOMETHING_ELSE: x" })).toBeNull();
    expect(parseGuardError(null)).toBeNull();
  });
});

describe("toUserMessage", () => {
  it("maps guards to readable messages", () => {
    expect(toUserMessage({ code: "P0001", message: "RIGHTS_BLOCKED: source video rights are red" })).toBe(
      "Blocked by rights check: source video rights are red.",
    );
    expect(toUserMessage({ code: "P0001", message: "SCRIPT_IMMUTABLE: x" })).toMatch(/read-only/);
  });

  it("maps constraint errors without leaking SQL", () => {
    expect(toUserMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBe(
      "This already exists.",
    );
    expect(toUserMessage({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/permission/);
    expect(toUserMessage({ code: "XX000", message: "internal" }, "fallback")).toBe("fallback");
  });
});
