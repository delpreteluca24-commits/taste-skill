import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const FIXTURE_PORT = 3199; // keep in sync with e2e/support.ts
const WORKER_HEALTH_PORT = 3198;

/**
 * E2E against a production build (`npm run build` first) and the local
 * Supabase stack. A throwaway admin user is created in global setup and
 * deleted (with its projects) in teardown.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ["desktop"],
    },
  ],
  webServer: [
    {
      command: `npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // fictional RSS feed for the M2 pipeline test (e2e/fixtures/feed.xml)
      command: "node e2e/fixtures/server.mjs",
      url: `http://127.0.0.1:${FIXTURE_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
    },
    {
      // background worker: fetches the fixture feed (loopback allowed in E2E only),
      // detects trends. No AI keys → AI jobs fail gracefully as "not configured", no cost.
      command: "npm run worker",
      url: `http://127.0.0.1:${WORKER_HEALTH_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        WORKER_HEALTH_PORT: String(WORKER_HEALTH_PORT),
        WORKER_POLL_MS: "500",
        ALLOW_PRIVATE_FETCH: "1",
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
      },
    },
  ],
});
