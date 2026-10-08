import { defineHandler } from "../context";

/** trends.detect — implemented by: Trends & Radar (agent B). */
export const handler = defineHandler({
  type: "trends.detect",
  async run() {
    throw new Error("trends.detect: not implemented yet");
  },
});
