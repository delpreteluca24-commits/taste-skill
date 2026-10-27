import { afterEach, describe, expect, it, vi } from "vitest";

import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { aiSwitchedOff } from "@/lib/ai/switch";

describe("AI_ENABLED kill switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on unless AI_ENABLED is explicitly false", () => {
    vi.stubEnv("AI_ENABLED", "");
    expect(aiSwitchedOff()).toBe(false);
    vi.stubEnv("AI_ENABLED", " False ");
    expect(aiSwitchedOff()).toBe(true);
  });

  it("makes a keyed provider report itself unconfigured, so no request is ever sent", () => {
    vi.stubEnv("AI_ENABLED", "false");
    expect(createAnthropicProvider({ apiKey: "sk-ant-api03-test" }).isConfigured()).toBe(false);
    vi.stubEnv("AI_ENABLED", "true");
    expect(createAnthropicProvider({ apiKey: "sk-ant-api03-test" }).isConfigured()).toBe(true);
  });
});
