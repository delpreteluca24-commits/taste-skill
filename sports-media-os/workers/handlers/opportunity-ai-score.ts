import { defineHandler } from "../context";

/** opportunity.ai_score — implemented by: Opportunities (agent C). */
export const handler = defineHandler({
  type: "opportunity.ai_score",
  async run() {
    throw new Error("opportunity.ai_score: not implemented yet");
  },
});
