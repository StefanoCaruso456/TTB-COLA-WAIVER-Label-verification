import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3001";
const baseURL = `http://localhost:${PORT}`;
const chromiumPath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(chromiumPath
      ? { launchOptions: { executablePath: chromiumPath } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT,
      USE_MOCK_EXTRACTION: "true",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://ttb:ttb@127.0.0.1:5432/ttb",
    },
  },
});
