import { defineHandler } from "../context";

/** factcheck.assist — implemented by: Research & fact check (agent D). */
export const handler = defineHandler({
  type: "factcheck.assist",
  async run() {
    throw new Error("factcheck.assist: not implemented yet");
  },
});
