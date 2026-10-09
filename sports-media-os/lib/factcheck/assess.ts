import type { AIRouter } from "@/lib/ai/router";
import type { AIProviderId, AIUsage } from "@/lib/ai/types";
import {
  buildFactCheckMessages,
  FACTCHECK_ASSESS_SYSTEM,
  factCheckOutputSchema,
  MAX_SOURCES_IN_FACTCHECK_PROMPT,
  type FactCheckAssessInput,
} from "@/prompts/factcheck/assess";

import { sanitiseFactCheck, type FactCheckSuggestion } from "./sanitize";

/**
 * One FACT_CHECK call through the AI router (model chosen per task, every call
 * logged with cost by the router). Only the claim and its linked sources go in;
 * the sanitised result is a suggestion — callers store it, never apply it.
 */
export type FactCheckResult = {
  suggestion: FactCheckSuggestion;
  /** ids of the sources actually sent to the model */
  assessedSourceIds: string[];
  provider: AIProviderId;
  model: string;
  usage: AIUsage;
  costUsd: number | null;
};

export async function requestFactCheck(ai: AIRouter, input: FactCheckAssessInput): Promise<FactCheckResult> {
  const sent = input.sources.slice(0, MAX_SOURCES_IN_FACTCHECK_PROMPT);
  const res = await ai.generateObject(
    "fact_check",
    {
      system: FACTCHECK_ASSESS_SYSTEM,
      messages: buildFactCheckMessages({ ...input, sources: sent }),
      cacheSystemPrompt: true,
    },
    factCheckOutputSchema,
  );
  const assessedSourceIds = sent.map((s) => s.id);
  return {
    suggestion: sanitiseFactCheck(res.data, assessedSourceIds),
    assessedSourceIds,
    provider: res.provider,
    model: res.model,
    usage: res.usage,
    costUsd: res.costUsd,
  };
}
