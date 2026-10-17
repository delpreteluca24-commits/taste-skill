import { describe, expect, it } from "vitest";

import { AGENTS } from "@/agents/registry";
import { MODULE_ICONS } from "@/components/layout/module-icons";
import { activeModuleKey, CURRENT_MILESTONE, isModuleAvailable, MODULES, NAV_GROUPS } from "@/lib/navigation";
import { Constants } from "@/types/database";

describe("agent registry", () => {
  it("covers exactly the agent_key enum of the database", () => {
    expect(AGENTS.map((a) => a.key).sort()).toEqual([...Constants.public.Enums.agent_key].sort());
  });
});

describe("navigation", () => {
  it("has unique keys and hrefs, an icon and a group for every module", () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(MODULES.length);
    const groups = new Set(NAV_GROUPS.map((g) => g.key));
    for (const m of MODULES) {
      expect(MODULE_ICONS[m.key]).toBeDefined();
      expect(groups.has(m.group)).toBe(true);
    }
  });

  it("lists every sidebar section required by the spec", () => {
    expect(MODULES.map((m) => m.label)).toEqual([
      "Dashboard",
      "Sports Radar",
      "Trends",
      "Opportunities",
      "Research",
      "Rights Center",
      "Pipeline",
      "Studio",
      "Calendar",
      "Analytics",
      "Agents",
      "Settings",
    ]);
  });

  it("resolves the active module for nested routes", () => {
    expect(activeModuleKey("/dashboard")).toBe("dashboard");
    expect(activeModuleKey("/settings/ai")).toBe("settings");
    expect(activeModuleKey("/projects/new")).toBeNull();
  });

  it("delivers every module in the current milestone", () => {
    expect(CURRENT_MILESTONE).toBe(5);
    for (const m of MODULES) expect(isModuleAvailable(m)).toBe(true);
  });

  it("orders the workflow steps", () => {
    expect(NAV_GROUPS.filter((g) => g.step).map((g) => g.label)).toEqual(["Discover", "Verify", "Produce", "Publish", "Learn"]);
  });
});
