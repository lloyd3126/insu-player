import { defineConfig } from "@playwright/test"

const port = Number(process.env.INSU_EXTENSION_E2E_PORT ?? 42872)
const baseURL = `http://127.0.0.1:${port}`
const bunBinary = process.env.INSU_BUN ?? "bun"

export default defineConfig({
  testDir: "./tests/extension",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL },
  webServer: {
    command: `${JSON.stringify(bunBinary)} tests/e2e/run-server.ts`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { INSU_E2E_PORT: String(port) },
  },
})
