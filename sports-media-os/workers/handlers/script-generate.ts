import { defineHandler } from "../context";

/** script.generate — implemented by: Script & Hook studio (agent G). */
export const handler = defineHandler({
  type: "script.generate",
  async run() {
    throw new Error("script.generate: not implemented yet");
  },
});
