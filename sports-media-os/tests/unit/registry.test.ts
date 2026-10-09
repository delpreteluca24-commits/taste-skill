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
      "Content",
      "Clips",
      "Editor",
      "Thumbnails",
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

  it("marks later-milestone modules as unavailable", () => {
    const dashboard = MODULES.find((m) => m.key === "dashboard")!;
    const clips = MODULES.find((m) => m.key === "clips")!;
    expect(isModuleAvailable(dashboard)).toBe(true);
    expect(CURRENT_MILESTONE).toBe(2);
    expect(isModuleAvailable(clips, CURRENT_MILESTONE)).toBe(false);
    expect(isModuleAvailable(clips, 3)).toBe(true);
  });
});
