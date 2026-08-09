import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.INSU_E2E_PORT ?? 42871)
const baseURL = process.env.INSU_E2E_BASE_URL ?? `http://127.0.0.1:${port}`
const bunBinary = process.env.INSU_BUN ?? "bun"

export default defineConfig({
  testDir: "./tests/e2e/specs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  },
  projects: [
    {
      name: "desktop-chrome",
      testIgnore: /responsive\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "mobile-chrome",
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: process.env.INSU_E2E_BASE_URL
    ? undefined
    : {
        command: `${JSON.stringify(bunBinary)} tests/e2e/run-server.ts`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        env: { INSU_E2E_PORT: String(port) },
      },
})
