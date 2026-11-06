import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://concierge:concierge@localhost:5433/concierge";
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/e2e/seed.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4100",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox"] },
  },
  webServer: [
    {
      command: "node tests/e2e/static-server.mjs",
      url: "http://localhost:4100",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run build && npm start",
      url: "http://localhost:3000/widget.js",
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: databaseUrl,
        APP_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
        FAKE_MODEL: "true",
        FAKE_EMBEDDINGS: "true",
        STORAGE_DRIVER: "local",
      },
    },
  ],
});
