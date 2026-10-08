import { defineHandler } from "../context";

/** script.transform — implemented by: Script & Hook studio (agent G). */
export const handler = defineHandler({
  type: "script.transform",
  async run() {
    throw new Error("script.transform: not implemented yet");
  },
});
