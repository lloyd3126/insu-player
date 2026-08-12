import { expect, test, chromium } from "@playwright/test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"

import { EXTENSION_CONNECTION_PROTOCOL_VERSION } from "../../src/shared/contracts/browser-extension"

function extractPackage(archive: Uint8Array, target: string) {
  const files = unzipSync(archive)
  for (const [relativePath, contents] of Object.entries(files)) {
    const output = path.join(target, relativePath)
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(output, contents)
  }
  return files
}

test("connects automatically from the service-specific extension ZIP", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("extension test requires baseURL")
  const serverOrigin = new URL(baseURL).origin
  const packageResponse = await fetch(`${serverOrigin}/api/extension/package`, {
    method: "POST",
    headers: { Origin: serverOrigin },
  })
  expect(packageResponse.status).toBe(200)

  const root = mkdtempSync(path.join(tmpdir(), "insu-extension-e2e-"))
  const extensionPath = path.join(root, "extension")
  const userDataDir = path.join(root, "profile")
  mkdirSync(extensionPath)
  const files = extractPackage(
    new Uint8Array(await packageResponse.arrayBuffer()),
    extensionPath,
  )
  expect(Object.keys(files)).toContain("pairing-bootstrap.json")

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
    if (await policy.isVisible()) {
      await policy.getByRole("button", { name: "我了解並同意" }).click()
    }

    const extensionPagePromise = context.waitForEvent("page")
    await serviceWorker.evaluate(async (url) => {
      await chrome.tabs.create({ url, active: false })
    }, `chrome-extension://${extensionId}/popup.html`)
    const extensionPage = await extensionPagePromise
    await extensionPage.waitForLoadState("domcontentloaded")

    await expect(extensionPage.getByRole("status")).toContainText(
      "已連接本機服務",
      { timeout: 10_000 },
    )
    await expect(extensionPage.locator(".eyebrow")).toHaveCSS(
      "color",
      "rgb(139, 124, 246)",
    )
    await expect(extensionPage.locator(".primary").first()).toHaveCSS(
      "background-color",
      "rgb(139, 124, 246)",
    )
    await expect(extensionPage.locator('input[type="file"]')).toHaveCount(0)
    await expect(
      extensionPage.getByRole("button", { name: /匯入配對檔/ }),
    ).toHaveCount(0)
    await expect(
      extensionPage.getByText(
        "點擊以下按鈕代表有權下載、轉錄與觀看這項內容，且同意把這組來源需要的 Cookie 傳到本機服務，只供這次下載使用。",
      ),
    ).toHaveCount(1)
    await expect(extensionPage.locator('input[type="checkbox"]')).toHaveCount(0)
    await expect(extensionPage.locator("#candidate-list")).toHaveCount(0)
    await expect(extensionPage.getByText(/^主要$|^備援/)).toHaveCount(0)
    await expect(
      extensionPage.getByRole("button", { name: /偵測 iframe|選擇來源模式/ }),
    ).toHaveCount(0)
    await expect
      .poll(() =>
        homepage.evaluate(async () => {
          const response = await fetch("/api/extension/pairing")
          return response.json()
        }),
      )
      .toMatchObject({
        protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
        paired: true,
      })

    const stored = await extensionPage.evaluate(async () =>
      chrome.storage.local.get(null),
    )
    expect(stored).toMatchObject({
      insuConnection: {
        protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
        serverOrigin,
        connectedAt: expect.any(String),
        token: expect.any(String),
      },
    })
    expect(JSON.stringify(stored)).not.toContain("invitationId")
    expect(JSON.stringify(stored)).not.toContain("ticket")
  } finally {
    await context.close()
    rmSync(root, { recursive: true, force: true })
  }
})
