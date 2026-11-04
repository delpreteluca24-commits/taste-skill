import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // server-only throws outside React Server Components; tests import server modules directly
    alias: { "server-only": new URL("./tests/support/server-only-stub.ts", import.meta.url).pathname },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          // Runs against a real Postgres with the Supabase migrations applied
          // (`npm run db:start` locally, `supabase start` in CI).
          name: "db",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
