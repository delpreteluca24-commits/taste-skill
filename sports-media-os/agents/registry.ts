import type { Database } from "@/types/database";

export type AgentKey = Database["public"]["Enums"]["agent_key"];

/**
 * Agent identities (M1: identity + purpose only).
 * Tools, input/output contracts, constraints and memory are added per agent
 * in Milestone 6 under agents/<name>/. No agent may perform destructive or
 * publishing actions without a human approval checkpoint.
 */
export type AgentIdentity = {
  key: AgentKey;
  name: string;
  purpose: string;
};

export const AGENTS: readonly AgentIdentity[] = [
  { key: "orchestrator", name: "Orchestrator", purpose: "Decides what runs next, routes results between agents, stops workflows." },
  { key: "sports_radar", name: "Sports Radar", purpose: "Tracks sports events and news from connected sources." },
  { key: "trend_hunter", name: "Trend Hunter", purpose: "Normalizes signals into trends and spots emerging stories." },
  { key: "researcher", name: "Researcher", purpose: "Builds the research workspace: sources, timeline, quotes, context." },
  { key: "fact_checker", name: "Fact Checker", purpose: "Verifies claims against sources; flags critical unverified facts." },
  { key: "rights", name: "Rights", purpose: "Classifies material GREEN / YELLOW / RED before production." },
  { key: "story", name: "Story", purpose: "Turns approved opportunities into stories and versioned scripts." },
  { key: "hook", name: "Hook", purpose: "Generates and scores hooks across six styles." },
  { key: "editor", name: "Editor", purpose: "Selects, reframes and captions clips for Shorts." },
  { key: "thumbnail", name: "Thumbnail", purpose: "Proposes thumbnail concepts and honest titles." },
  { key: "publisher", name: "Publisher", purpose: "Schedules and publishes approved content or prepares manual exports." },
  { key: "analytics", name: "Analytics", purpose: "Collects performance and compares predicted vs actual." },
  { key: "ceo", name: "CEO", purpose: "Weekly review: priorities, winning patterns, what to stop doing." },
] as const;
