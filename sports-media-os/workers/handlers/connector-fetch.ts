import { defineHandler } from "../context";

/** connector.fetch — implemented by: Connectors & ingestion (agent A). */
export const handler = defineHandler({
  type: "connector.fetch",
  async run() {
    throw new Error("connector.fetch: not implemented yet");
  },
});
