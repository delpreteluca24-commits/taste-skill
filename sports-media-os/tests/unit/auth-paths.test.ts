import { describe, expect, it } from "vitest";

import { isPublicPath, safeRedirectPath } from "@/lib/auth/paths";

describe("isPublicPath", () => {
  it("allows only login and health without a session", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/healthz")).toBe(false);
  });
});

describe("safeRedirectPath (open-redirect protection)", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirectPath("/settings")).toBe("/settings");
    expect(safeRedirectPath("/content?stage=ready")).toBe("/content?stage=ready");
  });

  it.each([
    ["//evil.com", "protocol-relative"],
    ["https://evil.com", "absolute URL"],
    ["/\\evil.com", "backslash trick"],
    ["javascript:alert(1)", "scheme"],
    ["/dashboard\n", "header injection"],
    ["", "empty"],
  ])("rejects %s (%s)", (target) => {
    expect(safeRedirectPath(target)).toBe("/dashboard");
  });

  it("never redirects back to a public page", () => {
    expect(safeRedirectPath("/login")).toBe("/dashboard");
  });

  it("falls back for non-strings", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath(42, "/x")).toBe("/x");
  });
});
