import { defineHandler } from "../context";

/** research.suggest — implemented by: Research & fact check (agent D). */
export const handler = defineHandler({
  type: "research.suggest",
  async run() {
    throw new Error("research.suggest: not implemented yet");
  },
});
