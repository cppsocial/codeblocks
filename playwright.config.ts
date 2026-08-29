import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { headless: true },
  webServer: {
    command: "pnpm demo:origins",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
