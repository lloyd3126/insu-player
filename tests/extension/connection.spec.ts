import { expect, test, chromium } from "@playwright/test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repositoryRoot = path.resolve(import.meta.dirname, "../..")
const extensionPath = path.join(
  repositoryRoot,
  "plugins/insu-player/chrome-extension",
)

test("connects the unpacked extension from the currently open INSU Player page", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("extension test requires baseURL")
  const userDataDir = mkdtempSync(path.join(tmpdir(), "insu-extension-e2e-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  try {
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 10_000,
      })
    }
    const extensionId = new URL(serviceWorker.url()).host
    const homepage = await context.newPage()
    await homepage.goto(baseURL)
    const policy = homepage.getByRole("dialog", { name: "使用規範" })
    await expect(policy).toBeVisible()
    await policy.getByRole("button", { name: "我了解並同意" }).click()
    await expect(
      homepage.getByRole("heading", { name: /用 Agent/ }),
    ).toBeVisible()

    await homepage.bringToFront()
    const extensionPagePromise = context.waitForEvent("page")
    await serviceWorker.evaluate(async (url) => {
      await chrome.tabs.create({ url, active: false })
    }, `chrome-extension://${extensionId}/popup.html`)
    const extensionPage = await extensionPagePromise
    await extensionPage.waitForLoadState("domcontentloaded")
    const connectButton = extensionPage.getByRole("button", {
      name: "連接目前的 INSU Player",
    })
    await expect(connectButton).toBeVisible()
    await connectButton.click()
    await expect(extensionPage.getByRole("status")).toContainText(
      "已連接本機服務",
    )
    await expect
      .poll(() =>
        homepage.evaluate(async () => {
          const response = await fetch("/api/extension/pairing")
          return response.json()
        }),
      )
      .toMatchObject({ protocolVersion: 2, paired: true })

    const stored = await extensionPage.evaluate(async () =>
      chrome.storage.local.get("insuConnection"),
    )
    expect(stored).toMatchObject({
      insuConnection: {
        protocolVersion: 2,
        serverOrigin: baseURL,
        connectedAt: expect.any(String),
      },
    })
  } finally {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
