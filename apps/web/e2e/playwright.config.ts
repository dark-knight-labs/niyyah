import { defineConfig, devices } from "@playwright/test";

/** Browser run of the Overview items (see run.sh, which seeds the API and starts both servers first). */
export default defineConfig({
  testDir: ".",
  outputDir: "./out/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "./out/results.json" }]],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3017",
    timezoneId: "Asia/Dhaka",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
});
