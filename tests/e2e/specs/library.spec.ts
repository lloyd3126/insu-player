import { expect, test, type Locator } from "@playwright/test"

import { HomePage } from "../pages/home.page"

async function openMediaDetails(library: Locator, title = "雙語測試影音") {
  const card = library.locator(".video-grid-card").filter({ hasText: title })
  await card.hover()
  await card.getByRole("button", { name: `設定 ${title}` }).click()
}

async function openMediaPlayer(library: Locator, title = "雙語測試影音") {
  await library
    .locator(".video-grid-card")
    .filter({ hasText: title })
    .getByRole("button", { name: `觀看 ${title}` })
    .click()
}

test.describe("library and details @critical", () => {
  test.describe.configure({ mode: "serial" })
  test("serves a browser-only card library without the homepage or Agent controls", async ({
    page,
  }) => {
    await page.goto("/extension/library")
    await expect(page.getByRole("searchbox", { name: "搜尋影音" })).toBeVisible()
    await expect(page.getByText("LOCAL LIBRARY", { exact: true })).toHaveCount(0)
    await expect(page.getByText("我的影音", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Chrome 影音頁", { exact: true })).toHaveCount(0)
    await expect(page.locator(".hero, .primary-nav, .prompt-action-card")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "轉錄設定" })).toHaveCount(0)
    const card = page.locator(".video-grid-card").filter({
      hasText: "雙語測試影音",
    })
    await expect(card).toBeVisible()
    await expect(card.getByRole("combobox")).toHaveCount(0)
    await expect(card.getByRole("button", { name: "觀看 雙語測試影音" })).toHaveCount(1)
    await card.getByRole("button", { name: "觀看 雙語測試影音" }).click()
    const player = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(player).toBeVisible()
    await expect(player.locator("iframe")).toHaveAttribute(
      "src",
      /\/watch\/demo-video\/?\?embed=1&caption=zh-TW/,
    )
    await player.getByRole("button", { name: "關閉播放器" }).click()
    await expect(player).toBeHidden()
    await expect(page).toHaveURL(/\/extension\/library$/)
  })

  test("keeps unfinished downloads out of the browser card library", async ({ page }) => {
    await page.route("**/api/library", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              kind: "download",
              id: "library-active-browser",
              sourceKind: "page",
              pageUrl: "https://example.test/active",
              sourceUrl: "https://example.test/active",
              videoId: "active-browser",
              title: "尚未完成的下載",
              thumbnailUrl: null,
              state: "downloading",
              stage: "media_download",
              progress: 45,
              message: "正在下載",
              errorCode: null,
              queueAhead: null,
              lowQualityApproved: false,
              authentication: "none",
              authenticationConsentAt: null,
              createdAt: "2026-08-11T00:00:00Z",
              updatedAt: "2026-08-11T00:01:00Z",
              completedAt: null,
            },
          ],
          queue: {
            paused: false,
            concurrency: 2,
            queuedCount: 0,
            activeCount: 1,
            attentionCount: 0,
          },
          serverTime: "2026-08-11T00:01:00Z",
        }),
      }),
    )

    await page.goto("/extension/library")
    await expect(page.locator(".video-grid-card")).toHaveCount(0)
    await expect(page.getByText("尚未完成的下載")).toHaveCount(0)
    await expect(page.getByText("目前還沒有影音")).toBeVisible()
  })

  test("keeps keyboard focus inside the lazy dialog loading state", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    let releaseBundle = () => {}
    const bundleGate = new Promise<void>((resolve) => {
      releaseBundle = resolve
    })
    let bundleRequested = false

    await page.route(/\/assets\/UsageGuideDialog-[^/]+\.js$/, async (route) => {
      bundleRequested = true
      await bundleGate
      await route.continue()
    })

    try {
      await page.goto("/guide/initialize", {
        waitUntil: "domcontentloaded",
      })
      await expect.poll(() => bundleRequested).toBe(true)
      const loading = page.getByRole("dialog", {
        name: "正在開啟開始說明",
      })
      await expect(loading).toBeVisible()
      await expect(loading).toBeFocused()
      for (const key of ["Tab", "Tab", "Shift+Tab"]) {
        await page.keyboard.press(key)
        await expect(loading).toBeFocused()
      }
    } finally {
      releaseBundle()
    }

    await expect(page.getByRole("dialog", { name: "開始說明" })).toBeVisible()
  })

  test("does not reveal the homepage while the player modal loads", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    let playerBundleRequested = false

    await page.route(/\/assets\/PlayerDialog-[^/]+\.js$/, async (route) => {
      playerBundleRequested = true
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })

    const card = library.locator(".video-grid-card").filter({
      hasText: "雙語測試影音",
    })
    await card.getByRole("button", { name: "觀看 雙語測試影音" }).click()

    await expect.poll(() => playerBundleRequested).toBe(true)
    await expect(library).toBeVisible()
    await expect(page).toHaveURL(/\/library\/grid$/)
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }),
    ).toBeVisible()
    await expect(page).toHaveURL(
      /\/player\/demo-video\?caption=zh-TW&returnTo=%2Flibrary%2Fgrid$/,
    )
  })

  test("hands the library directly to the player without a transparent frame", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    const cardButton = library
      .locator(".video-grid-card")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "觀看 雙語測試影音" })

    await cardButton.hover()
    await expect(library).toHaveCSS("opacity", "1")
    const frames = await cardButton.evaluate(async (button) => {
      const results: Array<{
        path: string
        dialogOpacity: number | null
        backdropOpacity: number | null
      }> = []

      const action = button as HTMLButtonElement
      action.click()
      await new Promise<void>((resolve) => {
        let stablePlayerFrames = 0
        let sampledFrames = 0
        const sample = () => {
          sampledFrames += 1
          const dialog = document.querySelector<HTMLElement>("[role=dialog]")
          const backdrop = document.querySelector<HTMLElement>(
            '[data-slot="dialog-overlay"]',
          )
          const player = document.querySelector<HTMLElement>(".player-stage")
          const dialogOpacity = dialog
            ? Number(getComputedStyle(dialog).opacity)
            : null
          const backdropOpacity = backdrop
            ? Number(getComputedStyle(backdrop).opacity)
            : null
          results.push({
            path: location.pathname,
            dialogOpacity,
            backdropOpacity,
          })

          stablePlayerFrames =
            player && dialogOpacity === 1 && backdropOpacity === 1
              ? stablePlayerFrames + 1
              : 0
          if (stablePlayerFrames >= 2 || sampledFrames >= 240) {
            resolve()
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      return results
    })

    const playerFrames = frames.filter((frame) =>
      frame.path.startsWith("/player/"),
    )
    expect(playerFrames.length).toBeGreaterThan(0)
    expect(
      playerFrames.every(
        (frame) =>
          frame.dialogOpacity === 1 && frame.backdropOpacity === 1,
      ),
    ).toBe(true)
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }),
    ).toBeVisible()
  })

  test("keeps modal tabs open after a page reload", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()

    await home.openNavigationDialog("我的提示", "我的提示")
    await expect(page).toHaveURL(/\/prompts$/)
    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "我的提示" }),
    ).toBeVisible()

    await page.getByRole("dialog", { name: "我的提示" }).getByRole("button", {
      name: "關閉",
    }).click()
    const library = await home.openLibrary()
    await openMediaDetails(library)
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "執行紀錄" }).click()
    await expect(page).toHaveURL(
      /\/jobs\/demo-video\/activity\?returnTo=%2Flibrary%2Fgrid$/,
    )

    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }).getByRole("tab", {
        name: "執行紀錄",
      }),
    ).toHaveAttribute("aria-selected", "true")
  })

  test("manages exact downloadable qualities in a reload-safe detail tab", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await openMediaDetails(library)

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "畫質管理" }).click()
    await expect(page).toHaveURL(
      /\/jobs\/demo-video\/quality\?returnTo=%2Flibrary%2Fgrid$/,
    )
    await expect(detail.getByText("720p", { exact: true }).first()).toBeVisible()
    const qualityTable = detail.getByRole("table")
    const downloadable = qualityTable.getByRole("row").filter({ hasText: "1080p" })
    await expect(downloadable.getByText("可下載", { exact: true })).toBeVisible()
    await downloadable.getByRole("button", { name: "下載" }).click()
    const confirmation = page.getByRole("alertdialog", {
      name: "下載 1080p 到影音庫",
    })
    await expect(confirmation).toContainText("完成並驗證後才會加入可播放畫質")
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname ===
          "/api/jobs/demo-video/media/renditions",
    )
    await confirmation.getByRole("button", { name: "下載到影音庫" }).click()
    expect((await request).postDataJSON()).toEqual({ height: 1080 })
    await expect(confirmation).toBeHidden()
    await expect(downloadable.getByText("正在下載", { exact: true })).toBeVisible()
    await expect(
      downloadable.getByRole("button", { name: /下載中/ }),
    ).toBeDisabled()
    await expect(
      downloadable.getByRole("button", { name: "下載", exact: true }),
    ).toHaveCount(0)
    await expect(downloadable.getByText("已下載", { exact: true })).toBeVisible()
    await expect(
      downloadable.getByRole("button", { name: "設為播放", exact: true }),
    ).toBeVisible()

    await page.reload()
    await expect(
      page
        .getByRole("dialog", { name: "雙語測試影音" })
        .getByRole("tab", { name: "畫質管理" }),
    ).toHaveAttribute("aria-selected", "true")
  })

  test("switches an already downloaded player quality from the quality selector", async ({
    page,
  }) => {
    const mediaCatalog = {
      schemaVersion: 1,
      videoId: "demo-video",
      revision: 2,
      activeRenditionId: "720p-demo",
      availableBytes: 10_000_000,
      sourceRefreshedAt: "2026-08-08T00:00:00.000Z",
      formats: [],
      renditions: [
        {
          id: "720p-demo",
          requestedHeight: 720,
          width: 1280,
          height: 720,
          container: "mp4",
          videoCodec: "avc1",
          audioCodec: "aac",
          sizeBytes: 18,
          checksum: "a".repeat(64),
          createdAt: "2026-08-08T00:00:00.000Z",
          active: true,
        },
        {
          id: "1080p-demo",
          requestedHeight: 1080,
          width: 1920,
          height: 1080,
          container: "mp4",
          videoCodec: "avc1",
          audioCodec: "aac",
          sizeBytes: 40,
          checksum: "b".repeat(64),
          createdAt: "2026-08-08T01:00:00.000Z",
          active: false,
        },
      ],
      operation: null,
    }
    await page.route(/\/api\/jobs\/demo-video\/media(?:\/active)?$/, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mediaCatalog),
        })
        return
      }
      const activated = {
        ...mediaCatalog,
        revision: 3,
        activeRenditionId: "1080p-demo",
        renditions: mediaCatalog.renditions.map((rendition) => ({
          ...rendition,
          active: rendition.id === "1080p-demo",
        })),
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(activated),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library
      .locator(".video-grid-card")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "觀看 雙語測試影音" })
      .click()
    const player = page.getByRole("dialog", { name: "雙語測試影音" })
    const quality = player.getByRole("combobox", { name: "播放器畫質" })
    await expect(quality).toContainText("720p")
    await quality.click()
    const activation = page.waitForRequest(
      (candidate) =>
        candidate.method() === "PUT" &&
        new URL(candidate.url()).pathname ===
          "/api/jobs/demo-video/media/active",
    )
    await page.getByRole("option", { name: "1080p" }).click()
    expect((await activation).postDataJSON()).toEqual({
      renditionId: "1080p-demo",
    })
    await expect(quality).toContainText("1080p")
  })

  test("returns through nested modal origins and preserves them after reload", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await openMediaPlayer(library)
    const playerPath =
      "/player/demo-video?caption=zh-TW&returnTo=%2Flibrary%2Fgrid"
    await expect(page).toHaveURL(new RegExp(`${playerPath.replaceAll("?", "\\?")}$`))

    await page.reload()
    const player = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(player).toBeVisible()
    await player.getByRole("button", { name: "詳細資訊" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/about\?returnTo=/)

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("button", { name: "關閉" }).click()
    await expect(player).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${playerPath.replaceAll("?", "\\?")}$`))

    await player.getByRole("button", { name: "關閉" }).click()
    const returnedLibrary = page.getByRole("dialog", { name: "影片中心" })
    await expect(returnedLibrary).toBeVisible()
    await expect(
      returnedLibrary.getByRole("tab", { name: "我的影音" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(page).toHaveURL(/\/library\/grid$/)

    await returnedLibrary.getByRole("button", { name: "關閉" }).click()
    await expect(home.heroHeading).toBeVisible()
    await expect(page).toHaveURL(/\/$/)

    await page.goto("/player/demo-video?caption=zh-TW")
    const directPlayer = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(directPlayer).toBeVisible()
    await directPlayer.getByRole("button", { name: "關閉" }).click()
    await expect(page.getByRole("dialog", { name: "影片中心" })).toBeVisible()
    await expect(page).toHaveURL(/\/library$/)
  })

  test("executes removal directly from the shared confirmation dialog", async ({
    page,
  }) => {
    let releasePreview = () => {}
    const previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve
    })
    await page.route("**/api/removals/preview", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await previewGate
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          target: { kind: "video", videoId: "demo-video" },
          planDigest: "a".repeat(64),
          blocked: [],
          warnings: [],
        }),
      })
    })
    await page.route("**/api/removals/execute", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          target: { kind: "video", videoId: "demo-video" },
          planDigest: "a".repeat(64),
          removed: true,
        }),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await openMediaDetails(library)

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("button", { name: "移除影音" }).click()
    const removal = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    const confirm = removal.getByRole("button", {
      name: /^(正在檢查|移除影音)$/,
    })
    await expect(confirm).toBeDisabled()
    releasePreview()
    await expect(confirm).toHaveText("移除影音")
    await expect(confirm).toBeEnabled()
    const executionRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/removals/execute",
    )
    await confirm.click()

    const execution = await executionRequest
    expect(execution.postDataJSON()).toEqual({
      target: { kind: "video", videoId: "demo-video" },
      planDigest: "a".repeat(64),
    })
    await expect(removal).toBeHidden()
    await expect(page).toHaveURL(/\/library\/grid$/)
    await expect(page.getByRole("dialog", { name: "影片中心" })).toBeVisible()
  })

  test("stays in my media after removing media from the grid", async ({
    page,
  }) => {
    await page.route("**/api/removals/preview", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          target: { kind: "video", videoId: "demo-video" },
          planDigest: "b".repeat(64),
          blocked: [],
          warnings: [],
        }),
      })
    })
    await page.route("**/api/removals/execute", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          target: { kind: "video", videoId: "demo-video" },
          planDigest: "b".repeat(64),
          removed: true,
        }),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    const card = library.locator(".video-grid-card").filter({
      hasText: "雙語測試影音",
    })
    await card.hover()
    await card.getByRole("button", { name: "移除影音 雙語測試影音" }).click()
    const removal = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    const confirm = removal.getByRole("button", { name: "移除影音" })
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(removal).toBeHidden()
    await expect(page).toHaveURL(/\/library\/grid$/)
    await expect(
      library.getByRole("tab", { name: "我的影音" }),
    ).toHaveAttribute("aria-selected", "true")
  })

  test("defaults to a YouTube-style grid when media exists", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    const gridTab = library.getByRole("tab", { name: "我的影音" })
    const grid = library.locator(".video-grid")
    const mediaPanel = library.getByRole("tabpanel", { name: "我的影音" })
    const search = mediaPanel.getByRole("searchbox", { name: "搜尋影音" })
    const card = grid.locator(".video-grid-card").filter({
      hasText: "雙語測試影音",
    })

    await expect(gridTab).toHaveAttribute("aria-selected", "true")
    await expect(card).toBeVisible()
    await expect(card.getByRole("heading", { name: "雙語測試影音" })).toBeVisible()
    await expect(card.locator(".video-grid-card__thumbnail")).toBeVisible()
    const duration = card.locator(".video-grid-card__duration")
    await expect(duration).toHaveText("2:05")
    await expect(duration).toBeHidden()
    const removeButton = card.getByRole("button", {
      name: "移除影音 雙語測試影音",
    })
    const settingsButton = card.getByRole("button", {
      name: "設定 雙語測試影音",
    })
    await expect(removeButton).toBeHidden()
    await expect(settingsButton).toBeHidden()
    const titleHeader = card.locator('[data-slot="card-header"]')
    expect((await titleHeader.boundingBox())?.height).toBeGreaterThanOrEqual(48)
    await card.hover()
    await expect(duration).toBeVisible()
    await expect(removeButton).toBeVisible()
    await expect(settingsButton).toBeVisible()
    const thumbnailBox = await card.locator(".video-grid-card__thumbnail").boundingBox()
    const removeButtonBox = await removeButton.boundingBox()
    const settingsButtonBox = await settingsButton.boundingBox()
    expect(removeButtonBox?.x).toBeGreaterThan(thumbnailBox?.x ?? 0)
    expect(removeButtonBox?.y).toBeGreaterThanOrEqual(thumbnailBox?.y ?? 0)
    expect(removeButtonBox?.x).toBeLessThanOrEqual(
      (thumbnailBox?.x ?? 0) + (thumbnailBox?.width ?? 0),
    )
    expect(removeButtonBox?.y).toBeLessThan(
      (thumbnailBox?.y ?? 0) + (thumbnailBox?.height ?? 0),
    )
    expect(settingsButtonBox?.x).toBeGreaterThanOrEqual(thumbnailBox?.x ?? 0)
    expect(settingsButtonBox?.y).toBeGreaterThanOrEqual(thumbnailBox?.y ?? 0)
    expect(settingsButtonBox?.x).toBeLessThan(removeButtonBox?.x ?? 0)
    await removeButton.click()
    const removal = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    await expect(removal).toBeVisible()
    await expect(page).toHaveURL(/\/library\/grid$/)
    await removal.getByRole("button", { name: "取消" }).click()
    await expect(removal).toBeHidden()
    await card.hover()
    await expect(settingsButton).toBeVisible()
    await settingsButton.click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/about\?returnTo=/)
    await page.getByRole("dialog", { name: "雙語測試影音" }).getByRole("button", { name: "關閉" }).click()
    await expect(page).toHaveURL(/\/library\/grid$/)
    await expect(library.locator(".metrics")).not.toBeVisible()
    await expect(card.getByText("字幕重排", { exact: true })).toHaveCount(0)
    await expect(card.getByRole("combobox")).toHaveCount(0)
    const storage = mediaPanel.getByRole("button", { name: /^共 / })
    await expect(storage).toBeVisible()
    await storage.hover()
    await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toContainText(
      "共",
    )
    const searchBox = await search.boundingBox()
    const storageBox = await storage.boundingBox()
    const panelMetrics = await mediaPanel.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        contentWidth:
          element.clientWidth - Number.parseFloat(style.paddingInlineEnd),
      }
    })
    expect(searchBox?.width ?? 0).toBeLessThan(panelMetrics.contentWidth)
    expect(storageBox?.x ?? 0).toBeGreaterThan(searchBox?.x ?? 0)
    await expect(mediaPanel).toHaveCSS("overflow-y", "hidden")
    await expect(mediaPanel.locator(".library-media-scroll-region")).toHaveCSS(
      "overflow-y",
      "auto",
    )
    await expect(mediaPanel.locator(".library-media-scroll-region")).toHaveCSS(
      "scrollbar-gutter",
      "stable",
    )
    const columnCount = await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    )
    expect(columnCount).toBeGreaterThan(0)
    expect(columnCount).toBeLessThanOrEqual(3)
  })

  test("persists two caption styles and synchronizes one style to the other", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()

    await expect(library.getByRole("tab")).toHaveText([
      "我的影音",
      "下載佇列",
      "字幕樣式",
    ])
    await library.getByRole("tab", { name: "字幕樣式" }).click()
    await expect(page).toHaveURL(/\/library\/subtitle-style$/)

    const stylePanel = library.getByRole("tabpanel", { name: "字幕樣式" })
    await expect(stylePanel.getByRole("tab")).toHaveText([
      "第一字幕",
      "第二字幕",
      "雙語字幕",
    ])
    await expect(stylePanel.getByRole("columnheader")).toHaveText([
      "設定",
      "自訂值",
    ])
    await stylePanel.getByRole("spinbutton", { name: "文字縮放" }).fill("1.25")
    await stylePanel.getByRole("button", { name: "同步到第二字幕" }).click()
    await stylePanel.getByRole("tab", { name: "第二字幕" }).click()
    await expect(
      stylePanel.getByRole("spinbutton", { name: "文字縮放" }),
    ).toHaveValue("1.25")
    await stylePanel
      .getByRole("textbox", { name: "文字顏色", exact: true })
      .fill("#00ffff")
    await stylePanel.getByRole("tab", { name: "雙語字幕" }).click()
    await expect(
      stylePanel.getByRole("button", { name: /同步到/ }),
    ).toHaveCount(0)
    await expect(stylePanel.getByLabel("雙語字幕預覽")).toBeVisible()
    await stylePanel.getByRole("spinbutton", { name: "字幕間距" }).fill("0.8")
    await stylePanel.getByRole("button", { name: "另存樣式" }).click()
    const saveDialog = page.getByRole("dialog", { name: "另存字幕樣式" })
    await saveDialog.getByRole("textbox", { name: "樣式名稱" }).fill("自訂閱讀")
    await saveDialog.getByRole("button", { name: "保存" }).click()
    await expect(saveDialog).toBeHidden()

    await page.reload()
    const reloadedLibrary = page.getByRole("dialog", { name: "影片中心" })
    await expect(
      reloadedLibrary.getByRole("tab", { name: "字幕樣式" }),
    ).toHaveAttribute("aria-selected", "true")
    const reloadedStylePanel = reloadedLibrary.getByRole("tabpanel", {
      name: "字幕樣式",
    })
    await reloadedStylePanel.getByRole("tab", { name: "第一字幕" }).click()
    await expect(
      reloadedStylePanel.getByRole("spinbutton", { name: "文字縮放" }),
    ).toHaveValue("1.25")
    await reloadedStylePanel.getByRole("tab", { name: "第二字幕" }).click()
    await expect(
      reloadedStylePanel.getByRole("textbox", {
        name: "文字顏色",
        exact: true,
      }),
    ).toHaveValue("#00ffff")
    await reloadedStylePanel.getByRole("tab", { name: "雙語字幕" }).click()
    await expect(
      reloadedStylePanel.getByRole("spinbutton", { name: "字幕間距" }),
    ).toHaveValue("0.8")
    await expect(
      reloadedStylePanel.getByRole("combobox", { name: "已保存樣式" }),
    ).toContainText("自訂閱讀")
  })

  test("imports a local file from the media toolbar and publishes its card", async ({
    page,
  }, testInfo) => {
    const title = `Local import ${testInfo.parallelIndex} ${testInfo.retry} ${Date.now()}`
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    const mediaPanel = library.getByRole("tabpanel", { name: "我的影音" })
    const storage = mediaPanel.getByRole("button", { name: /^共 / })
    const importButton = mediaPanel.getByRole("button", { name: "匯入本機影音" })
    const [storageBox, importBox] = await Promise.all([
      storage.boundingBox(),
      importButton.boundingBox(),
    ])
    expect(importBox?.x ?? 0).toBeGreaterThan(storageBox?.x ?? 0)

    await mediaPanel.locator('input[aria-label="選擇本機影音"]').setInputFiles({
      name: `${title}.mp4`,
      mimeType: "video/mp4",
      buffer: Buffer.from(`e2e-media-${title}`),
    })
    const importDialog = page.getByRole("dialog", { name: "匯入本機影音" })
    await expect(importDialog.getByRole("textbox", { name: "影音標題" })).toHaveValue(
      title,
    )
    await importDialog
      .getByRole("checkbox", { name: "我有權匯入、轉錄與觀看這個影音" })
      .check()
    await importDialog.getByRole("button", { name: "開始匯入" }).click()
    await expect(importDialog).toBeHidden()

    const card = mediaPanel.locator(".video-grid-card").filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByRole("button", { name: `觀看 ${title}` })).toBeVisible({
      timeout: 10_000,
    })
  })

  test("defaults to the list tab when the center is empty", async ({ page }) => {
    await page.route("**/api/library", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          queue: {
            paused: false,
            concurrency: 2,
            queuedCount: 0,
            activeCount: 0,
            attentionCount: 0,
          },
          serverTime: new Date().toISOString(),
        }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()

    await expect(
      library.getByRole("tab", { name: "下載佇列" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(library.getByText("目前沒有下載工作")).toBeVisible()
    await expect(library.getByRole("columnheader", { name: "影音" })).toHaveCSS(
      "align-items",
      "center",
    )
    const emptyRow = library.getByRole("row", { name: /目前沒有下載工作/ })
    const backgroundBeforeHover = await emptyRow.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await emptyRow.hover()
    await expect(emptyRow).toHaveCSS("background-color", backgroundBeforeHover)
  })

  test("refreshes the download queue every second and stops outside that tab", async ({
    page,
  }) => {
    let libraryReads = 0
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/library"
      ) {
        libraryReads += 1
      }
    })
    const home = new HomePage(page)
    await home.goto()
    await page.clock.install()
    const library = await home.openLibrary()
    await expect.poll(() => libraryReads).toBeGreaterThanOrEqual(1)
    const initialReads = libraryReads

    await page.clock.fastForward(1_000)
    expect(libraryReads).toBe(initialReads)

    await library.getByRole("tab", { name: "下載佇列" }).click()
    const readsBeforeQueueRefresh = libraryReads
    await page.clock.fastForward(1_000)
    await expect.poll(() => libraryReads).toBeGreaterThan(readsBeforeQueueRefresh)

    await library.getByRole("button", { name: "關閉" }).click()
    const readsAfterClose = libraryReads
    await page.clock.fastForward(1_000)
    expect(libraryReads).toBe(readsAfterClose)
  })

  test("shows only download work in the compact queue table", async ({ page }) => {
    const activeItem = {
      kind: "download",
      id: "library-active",
      sourceKind: "page",
      pageUrl: "https://www.youtube.com/watch?v=active-video",
      sourceUrl: "https://www.youtube.com/watch?v=active-video",
      videoId: "active-video",
      title: "Active Video",
      thumbnailUrl: null,
      state: "downloading",
      stage: "media_download",
      progress: 45,
      message: "正在下載 1080p 影片",
      errorCode: null,
      queueAhead: null,
      lowQualityApproved: false,
      authentication: "none",
      authenticationConsentAt: null,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:01:00Z",
      completedAt: null,
    }
    await page.route("**/api/library", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [activeItem],
          queue: {
            paused: false,
            concurrency: 2,
            queuedCount: 0,
            activeCount: 1,
            attentionCount: 0,
          },
          serverTime: "2026-08-11T00:01:00Z",
        }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "下載佇列" }).click()
    await expect(library.locator(".metrics")).toHaveCount(0)
    await expect(library.getByRole("searchbox", { name: "搜尋影音" })).toHaveCount(0)
    await expect(library.getByRole("combobox", { name: "篩選狀態" })).toHaveCount(0)
    await expect(library.getByRole("button", { name: /^共 / })).toHaveCount(0)
    await expect(library.getByRole("button", { name: "重新整理下載佇列" })).toHaveCount(0)
    const table = library.getByRole("table")
    const row = table.getByRole("row").filter({ hasText: "Active Video" })

    await expect(table.getByRole("columnheader")).toHaveText(["影音", "操作"])
    await expect(table.getByRole("columnheader", { name: "字幕" })).toHaveCount(0)
    await expect(table.getByRole("columnheader", { name: "操作" })).toBeVisible()
    await expect(library.getByText("01 / INSU COLLECTION", { exact: true })).toHaveCount(0)
    await expect(library.getByText("影音處理資訊", { exact: true })).toHaveCount(0)
    await expect(row.getByText("45%", { exact: true })).toBeVisible()
    const detailsPanel = library.getByRole("tabpanel", { name: "下載佇列" })
    const tableFrame = library.locator(".job-table-frame")
    await expect(detailsPanel).toHaveCSS("overflow-y", "hidden")
    await expect(tableFrame).toHaveCSS("overflow-y", "hidden")
    await expect(table.locator("tbody")).toHaveCSS("overflow-y", "auto")
    await expect(table.locator("tbody")).toHaveCSS("scrollbar-gutter", "stable")
    expect(await table.evaluate((element) => getComputedStyle(element).tableLayout)).toBe("fixed")
    const actionCell = row.locator('[data-label="操作"]')
    const videoCell = row.locator('[data-label="影音"]')
    const [actionsBox, actionCellBox, videoCellBox] = await Promise.all([
      row.locator(".library-download-actions").boundingBox(),
      actionCell.boundingBox(),
      videoCell.boundingBox(),
    ])
    expect(actionsBox?.width ?? 0).toBeLessThanOrEqual(actionCellBox?.width ?? 0)
    expect(videoCellBox?.width).toBeGreaterThan(actionCellBox?.width ?? 0)
    await expect(row.getByRole("link", { name: "開啟來源 Active Video" })).toBeVisible()
    await expect(row.getByRole("button", { name: "暫停下載 Active Video" })).toBeVisible()
    await expect(row.getByRole("button", { name: "移除任務 Active Video" })).toBeVisible()
    await expect(library.getByText("雙語測試影音")).toHaveCount(0)

    await library.getByRole("tab", { name: "我的影音" }).click()
    await expect(library.locator(".video-grid-card")).toHaveCount(0)
    await expect(library.getByText("目前還沒有影音")).toBeVisible()
  })

  test("separates media facts subtitles segmentation and processing records", async ({
    page,
  }) => {
    let subtitleCatalogRequests = 0
    let subtitleArtifactRequests = 0
    let logRequests = 0
    page.on("request", (request) => {
      const url = request.url()
      if (url.endsWith("/api/jobs/demo-video/subtitles")) {
        subtitleCatalogRequests += 1
      }
      if (url.includes("/api/jobs/demo-video/subtitles/artifacts/")) {
        subtitleArtifactRequests += 1
      }
      if (url.includes("/api/jobs/demo-video/log")) logRequests += 1
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await openMediaDetails(library)

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(detail.getByRole("tab")).toHaveText([
      "關於影音",
      "影音狀態",
      "畫質管理",
      "字幕管理",
      "影音摘要",
      "影音大綱",
      "執行紀錄",
    ])
    await expect(detail.getByRole("tab", { name: "關於影音" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(detail.getByText("來源", { exact: true })).toBeVisible()
    await expect(detail.getByText("時長", { exact: true })).toBeVisible()
    await expect(detail.getByText("容量", { exact: true })).toBeVisible()
    await expect(detail.getByText("更新時間", { exact: true })).toBeVisible()
    const aboutPanel = detail.getByRole("tabpanel", { name: "關於影音" })
    await expect(aboutPanel.locator(".job-next-action")).toHaveCount(0)
    await expect(aboutPanel.getByText("狀態歷程", { exact: true })).toHaveCount(
      0,
    )
    await expect(
      aboutPanel.getByText("最新紀錄優先", { exact: true }),
    ).toHaveCount(0)
    await expect(aboutPanel.getByRole("table")).toHaveCount(0)
    const removalTrigger = aboutPanel.getByRole("button", { name: "移除影音" })
    await expect(removalTrigger).toBeVisible()
    await removalTrigger.click()
    const removalDialog = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    await expect(removalDialog).toBeVisible()
    await expect(removalDialog).toContainText(
      "這會永久移除影音及其所有衍生內容，且無法復原。",
    )
    await expect(removalDialog).not.toContainText("Agent")
    await expect(removalDialog).not.toContainText("plan digest")
    const nestedOverlay = page.locator(
      '[data-slot="alert-dialog-overlay"][data-emphasis="strong"]',
    )
    await expect(nestedOverlay).toBeVisible()
    expect(
      await nestedOverlay.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toContain("0.95")
    await expect(
      removalDialog.getByRole("button", { name: "複製提示" }),
    ).toHaveCount(0)
    await expect(
      removalDialog.getByRole("button", { name: "移除影音" }),
    ).toBeEnabled()
    await removalDialog.getByRole("button", { name: "取消" }).click()
    await expect(removalDialog).toBeHidden()
    await expect(removalTrigger).toBeFocused()
    await detail.getByRole("tab", { name: "影音狀態" }).click()
    const statusPanel = detail.getByRole("tabpanel", { name: "影音狀態" })
    const historyTable = statusPanel.getByRole("table")
    await expect(historyTable.getByRole("columnheader")).toHaveText([
      "時間",
      "狀態",
      "訊息",
    ])
    const historyRows = historyTable.getByRole("row")
    await expect(historyRows).toHaveCount(3)
    await expect(historyRows.nth(1)).toContainText("字幕已完成")
    await expect(historyRows.nth(2)).toContainText("影音處理中")
    await expect(statusPanel).toHaveCSS("overflow-y", "hidden")
    await expect(statusPanel.locator(".history-table-container")).toHaveCSS(
      "overflow-y",
      "hidden",
    )
    await expect(statusPanel.locator(".history-table__body")).toHaveCSS(
      "overflow-y",
      "auto",
    )
    await expect(historyTable.getByRole("columnheader", { name: "時間" })).toHaveCSS(
      "align-items",
      "center",
    )
    await expect(historyRows.nth(1).getByRole("cell").first()).toHaveCSS(
      "align-items",
      "center",
    )
    await expect(detail.getByText("Workflow log", { exact: true })).toHaveCount(
      0,
    )
    expect(subtitleCatalogRequests).toBe(0)
    expect(subtitleArtifactRequests).toBe(0)
    expect(logRequests).toBe(0)

    await detail.getByRole("tab", { name: "字幕管理" }).click()
    await expect(page).toHaveURL(
      /\/jobs\/demo-video\/subtitles\/source\?returnTo=/,
    )
    const subtitlePanel = detail.getByRole("tabpanel", { name: "字幕管理" })
    await expect(subtitlePanel.getByRole("tab")).toHaveText([
      "原始字幕",
      "校正字幕",
      "翻譯字幕",
      "切分字幕",
    ])
    const sourcePanel = subtitlePanel.getByRole("tabpanel", {
      name: "原始字幕",
    })
    const subtitleNextAction = subtitlePanel.locator(".job-next-action")
    await expect(subtitleNextAction).toContainText("字幕已完成")
    await expect(
      subtitleNextAction.getByRole("button", { name: "複製提示" }),
    ).toHaveCount(0)
    await expect(subtitlePanel.getByText("PLAYBACK VERSION", { exact: true })).toHaveCount(0)
    await expect(subtitlePanel.getByRole("combobox", { name: /播放版本/ })).toHaveCount(0)
    const sourceRevisions = sourcePanel.getByRole("table", {
      name: "原始字幕版本",
    })
    await expect(sourceRevisions.getByRole("columnheader")).toHaveText([
      "版本",
      "語言",
      "處理者",
      "狀態",
      "驗證",
      "播放",
      "完成時間",
      "操作",
    ])
    await expect(sourceRevisions.getByText("r1", { exact: true })).toBeVisible()
    await expect(
      sourceRevisions.getByText("本機 · medium", { exact: true }),
    ).toBeVisible()
    await expect.poll(() => subtitleCatalogRequests).toBe(1)
    expect(subtitleArtifactRequests).toBe(0)
    const sourcePreviewTrigger = sourceRevisions.getByRole("button", {
      name: "預覽原始字幕 r1",
    })
    const sourceActions = sourceRevisions.getByRole("button")
    await expect(sourceActions).toHaveCount(3)
    await expect(sourceActions.nth(0)).toHaveAccessibleName("預覽原始字幕 r1")
    await expect(sourceActions.nth(1)).toHaveAccessibleName("下載原始字幕 r1")
    await expect(sourceActions.nth(2)).toHaveAccessibleName("移除原始字幕 r1")
    await sourceActions.nth(1).click()
    const exportDialog = page.getByRole("dialog", { name: "下載原始字幕 r1" })
    const downloadPromise = page.waitForEvent("download")
    await exportDialog.getByRole("link", { name: "TXT" }).click()
    const subtitleDownload = await downloadPromise
    expect(subtitleDownload.suggestedFilename()).toBe(
      "demo-video-source-en-r1.txt",
    )
    await exportDialog.getByRole("button", { name: "關閉" }).click()
    await sourcePreviewTrigger.click()
    await expect(page).toHaveURL(
      /artifact=demo-video-source-model-transcript-en-r1/,
    )
    const sourcePreview = page.getByRole("dialog", {
      name: "原始字幕 · r1",
    })
    await expect(sourcePreview).toBeVisible()
    const subtitlePreviewOverlay = page.locator(
      '[data-slot="dialog-overlay"][data-emphasis="strong"]',
    )
    await expect(subtitlePreviewOverlay).toBeVisible()
    const sourceComparison = sourcePreview.getByRole("table")
    await expect(
      sourceComparison.getByRole("columnheader", { name: "en" }),
    ).toBeVisible()
    await expect(
      sourceComparison.getByRole("columnheader", { name: "zh-TW" }),
    ).toHaveCount(0)
    const longEnglishCue = sourceComparison.getByText(
      /For the last month I have been experimenting/,
    )
    await expect(longEnglishCue).toBeVisible()
    expect(
      await longEnglishCue.evaluate(
        (element) => getComputedStyle(element).whiteSpace,
      ),
    ).toBe("normal")
    await expect.poll(() => subtitleArtifactRequests).toBe(1)
    await sourcePreview.getByRole("button", { name: "關閉" }).click()
    await expect(sourcePreview).toBeHidden()
    await expect(page).not.toHaveURL(/artifact=/)
    await expect(sourcePreviewTrigger).toBeFocused()
    expect(logRequests).toBe(0)

    await subtitlePanel.getByRole("tab", { name: "校正字幕" }).click()
    const proofreadPanel = subtitlePanel.getByRole("tabpanel", {
      name: "校正字幕",
    })
    await expect(
      proofreadPanel.getByRole("heading", { name: "新增校正字幕" }),
    ).toBeVisible()
    await expect(
      proofreadPanel.getByRole("button", { name: "複製提示" }),
    ).toBeEnabled()
    expect(subtitleArtifactRequests).toBe(1)
    await proofreadPanel
      .getByRole("button", {
        name: "預覽校正字幕 r1",
      })
      .click()
    const proofreadPreview = page.getByRole("dialog", {
      name: "校正字幕 · r1",
    })
    await expect(
      proofreadPreview.getByRole("columnheader", { name: "en · 輸入字幕" }),
    ).toBeVisible()
    await expect(
      proofreadPreview.getByRole("columnheader", { name: "en · 輸出字幕" }),
    ).toBeVisible()
    await expect.poll(() => subtitleArtifactRequests).toBe(2)
    await proofreadPreview.getByRole("button", { name: "關閉" }).click()

    await detail.getByRole("tab", { name: "影音摘要" }).click()
    const summaryPanel = detail.getByRole("tabpanel", { name: "影音摘要" })
    await expect(
      summaryPanel.getByRole("heading", { name: "請 Agent 建立文字摘要" }),
    ).toBeVisible()
    await expect(summaryPanel.getByText("尚未建立文字摘要")).toBeVisible()
    await expect(
      summaryPanel.getByRole("heading", { name: "請 Agent 建立心智圖" }),
    ).toHaveCount(0)
    await detail.getByRole("tab", { name: "影音大綱" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/outline\?returnTo=/)
    const outlinePanel = detail.getByRole("tabpanel", { name: "影音大綱" })
    await expect(
      outlinePanel.getByRole("heading", { name: "請 Agent 建立心智圖" }),
    ).toBeVisible()
    await expect(outlinePanel.getByText("尚未建立心智圖")).toBeVisible()

    await detail.getByRole("tab", { name: "字幕管理" }).click()
    await subtitlePanel.getByRole("tab", { name: "翻譯字幕" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/subtitles\/translation/)
    const translatedPanel = subtitlePanel.getByRole("tabpanel", {
      name: "翻譯字幕",
    })
    await expect(
      translatedPanel.getByRole("heading", { name: "新增翻譯字幕" }),
    ).toBeVisible()
    await expect(translatedPanel).toContainText(
      "沿用 en · 校正字幕 r1 的文字與既有音訊時間軸",
    )
    await expect(
      translatedPanel.getByText("Agent · codex", { exact: true }),
    ).toBeVisible()
    expect(subtitleArtifactRequests).toBe(2)
    await translatedPanel
      .getByRole("button", {
        name: "預覽翻譯字幕 r1",
      })
      .click()
    const translatedPreview = page.getByRole("dialog", {
      name: "翻譯字幕 · r1",
    })
    const translatedComparison = translatedPreview.getByRole("table")
    await expect(
      translatedComparison.getByRole("columnheader", { name: "en" }),
    ).toBeVisible()
    await expect(
      translatedComparison.getByRole("columnheader", { name: "zh-TW" }),
    ).toBeVisible()
    await expect(
      translatedComparison.getByText(/過去一個月我一直在嘗試 Vibe Coding/),
    ).toBeVisible()
    await expect.poll(() => subtitleArtifactRequests).toBe(3)
    await translatedPreview.getByRole("button", { name: "關閉" }).click()

    await subtitlePanel.getByRole("tab", { name: "切分字幕" }).click()
    const segmentedPanel = subtitlePanel.getByRole("tabpanel", {
      name: "切分字幕",
    })
    await expect(
      segmentedPanel.getByRole("heading", { name: "新增切分字幕" }),
    ).toBeVisible()
    await expect(segmentedPanel).toContainText(
      "沿用 zh-TW · 翻譯字幕 r1 與既有音訊時間軸",
    )
    await expect(
      segmentedPanel.getByText("Agent · codex", { exact: true }),
    ).toBeVisible()
    expect(subtitleArtifactRequests).toBe(3)
    await expect(
      segmentedPanel.getByText("有驗證提醒", { exact: true }),
    ).toBeVisible()
    await expect(
      segmentedPanel.getByText("1 個提醒", { exact: true }),
    ).toBeVisible()
    await expect(
      segmentedPanel.getByRole("button", { name: "移除切分字幕 r1" }),
    ).toBeVisible()
    await segmentedPanel
      .getByRole("button", {
        name: "預覽切分字幕 r1",
      })
      .click()
    const segmentedPreview = page.getByRole("dialog", {
      name: "切分字幕 · r1",
    })
    const segmentedComparison = segmentedPreview.getByRole("table")
    await expect(
      segmentedComparison.getByRole("columnheader", { name: "en" }),
    ).toBeVisible()
    await expect(
      segmentedComparison.getByRole("columnheader", { name: "zh-TW" }),
    ).toBeVisible()
    await expect.poll(() => subtitleArtifactRequests).toBe(4)
    await segmentedPreview.getByRole("button", { name: "關閉" }).click()

    await detail.getByRole("tab", { name: "執行紀錄" }).click()
    const activityPanel = detail.getByRole("tabpanel", {
      name: "執行紀錄",
    })
    await expect(
      activityPanel.getByText("狀態歷程", { exact: true }),
    ).toHaveCount(0)
    await expect(activityPanel.locator(".job-facts--activity")).toHaveCount(0)
    await expect(
      activityPanel.getByRole("heading", { name: "請 Agent 檢查紀錄" }),
    ).toBeVisible()
    await expect(
      activityPanel.getByRole("button", { name: "複製提示" }),
    ).toBeVisible()
    await expect(
      activityPanel.getByText("Workflow log", { exact: true }),
    ).toHaveCount(0)
    await expect(
      activityPanel.getByText("最近 180 行", { exact: true }),
    ).toHaveCount(0)
    await expect(
      activityPanel.getByText("download complete", { exact: false }),
    ).toBeVisible()
    await expect.poll(() => logRequests).toBe(1)
    const [panelBox, logBox] = await Promise.all([
      activityPanel.boundingBox(),
      activityPanel.locator(".workflow-log-card").boundingBox(),
    ])
    expect(logBox?.width ?? 0).toBeGreaterThan((panelBox?.width ?? 0) * 0.9)

    await detail.getByRole("tab", { name: "字幕管理" }).click()
    await subtitlePanel.getByRole("tab", { name: "翻譯字幕" }).click()
    await subtitlePanel
      .getByRole("tabpanel", {
        name: "翻譯字幕",
      })
      .getByRole("button", {
        name: "預覽翻譯字幕 r1",
      })
      .click()
    await page.reload()
    const reloadedPreview = page.getByRole("dialog", {
      name: "翻譯字幕 · r1",
    })
    await expect(reloadedPreview).toBeVisible()
    await reloadedPreview.getByRole("button", { name: "關閉" }).click()
    const reloadedDetail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(
      reloadedDetail.getByRole("tab", { name: "字幕管理" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(
      reloadedDetail.getByRole("tab", { name: "翻譯字幕" }),
    ).toHaveAttribute("aria-selected", "true")
  })

  test("virtualizes a long bilingual caption timeline", async ({ page }) => {
    const rows = Array.from({ length: 240 }, (_, index) => ({
      id: `en:${index}`,
      start: index * 2,
      end: index * 2 + 2,
      cues: {
        "source-en": `English sentence ${index + 1}`,
        "target-zh-TW": `繁中句子 ${index + 1}`,
      },
    }))
    await page.route(
      "**/api/jobs/demo-video/subtitles/artifacts/demo-video-source-model-transcript-en-r1/captions",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            videoId: "demo-video",
            baselineTrackId: "source-en",
            tracks: [
              {
                id: "source-en",
                code: "en",
                label: "English",
                cueCount: rows.length,
              },
              {
                id: "target-zh-TW",
                code: "zh-TW",
                label: "繁體中文",
                cueCount: rows.length,
              },
            ],
            rows,
          }),
        }),
    )

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await openMediaDetails(library)
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "字幕管理" }).click()

    const sourceRevisions = detail.getByRole("table", {
      name: "原始字幕版本",
    })
    await sourceRevisions
      .getByRole("button", {
        name: "預覽原始字幕 r1",
      })
      .click()
    const preview = page.getByRole("dialog", { name: "原始字幕 · r1" })
    const table = preview.getByRole("table")
    const viewport = preview.locator(".caption-table-frame")
    await expect(table).toHaveAttribute("aria-rowcount", "241")
    await expect(
      table.getByText("English sentence 1", { exact: true }),
    ).toBeVisible()
    expect(await table.getByRole("row").count()).toBeLessThan(50)
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(
      table.getByText("English sentence 240", { exact: true }),
    ).toBeVisible()
    expect(await table.getByRole("row").count()).toBeLessThan(50)
  })

  test("persists paused and closing playback against the active video", async ({
    page,
  }) => {
    const saved: Array<{
      path: string
      time?: number
      duration?: number | null
      captionLanguage?: string | null
    }> = []
    await page.route(/\/api\/jobs\/[^/]+\/playback$/, async (route) => {
      const payload = route.request().postDataJSON() as {
        time?: number
        duration?: number | null
        captionLanguage?: string | null
      }
      saved.push({
        path: new URL(route.request().url()).pathname,
        ...payload,
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...payload,
          updatedAt: "2026-08-09T00:00:00.000Z",
        }),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    const card = library.locator(".video-grid-card").filter({
      hasText: "雙語測試影音",
    })
    await card.getByRole("button", { name: "觀看 雙語測試影音" }).click()
    const playerDialog = page.getByRole("dialog", { name: "雙語測試影音" })
    const playerFrame = page.frameLocator('iframe[title="本機影音播放器"]')
    await expect(playerFrame.locator("body")).toBeVisible()

    await playerDialog.getByLabel("第一字幕").click()
    await page.getByRole("option", { name: "en", exact: true }).click()
    await expect
      .poll(
        () =>
          saved.filter((entry) => entry.captionLanguage === "en").length,
      )
      .toBe(1)

    const sendPlayback = (type: string, time: number) =>
      playerFrame.locator("body").evaluate(
        (_, message) => {
          window.parent.postMessage(message, window.location.origin)
        },
        {
          type,
          videoId: "demo-video",
          time,
          duration: 120,
        },
      )

    await sendPlayback("player:paused", 21)
    await expect.poll(() => saved.filter((entry) => entry.time === 21).length).toBe(1)

    await sendPlayback("player:time", 42)
    await playerDialog.getByRole("button", { name: "詳細資訊" }).click()
    await expect.poll(() => saved.filter((entry) => entry.time === 42).length).toBe(1)
    expect(saved.filter((entry) => entry.time === 21 || entry.time === 42)).toEqual([
      {
        path: "/api/jobs/demo-video/playback",
        time: 21,
        duration: 120,
      },
      {
        path: "/api/jobs/demo-video/playback",
        time: 42,
        duration: 120,
      },
    ])
  })

  test("opens the same-origin player in an iframe and can transition to details", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()
    await page.evaluate(async () => {
      const response = await fetch("/api/subtitle-styles/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: null,
          styles: {
            primary: {
              fontScale: 1,
              fontWeight: 650,
              textColor: "#ffffff",
              backgroundColor: "#030b0c",
              backgroundOpacity: 0.72,
              lineHeight: 1.3,
              paddingX: 0.7,
              paddingY: 0.38,
              radius: 0.18,
              shadow: "soft",
              letterSpacing: 0,
            },
            secondary: {
              fontScale: 1,
              fontWeight: 650,
              textColor: "#ffe08a",
              backgroundColor: "#030b0c",
              backgroundOpacity: 0.72,
              lineHeight: 1.3,
              paddingX: 0.7,
              paddingY: 0.38,
              radius: 0.18,
              shadow: "soft",
              letterSpacing: 0,
            },
            bilingual: { gap: 0.5 },
          },
        }),
      })
      if (!response.ok) throw new Error(`failed to reset subtitle styles: ${response.status}`)
    })
    const library = await home.openLibrary()
    await openMediaPlayer(library)

    const playerDialog = page.getByRole("dialog", { name: "雙語測試影音" })
    const playerFrame = page.frameLocator('iframe[title="本機影音播放器"]')
    await expect(playerFrame.getByRole("region", { name: "本機影音播放器" })).toBeVisible()
    await expect(playerFrame.locator("video")).toBeVisible()
    await expect(
      playerDialog.getByRole("combobox", { name: "第一字幕" }),
    ).toContainText("zh-TW")
    await expect(
      playerDialog.getByRole("combobox", { name: "第二字幕" }),
    ).toContainText("關閉字幕")

    await playerDialog.getByRole("combobox", { name: "第二字幕" }).click()
    await page.getByRole("option", { name: "en", exact: true }).click()
    await expect(page).toHaveURL(/caption=zh-TW&caption2=en/)
    await expect(playerFrame.locator("#primary-caption")).toContainText(
      "過去一個月我一直在嘗試",
    )
    await expect(playerFrame.locator("#secondary-caption")).toContainText(
      "For the last month",
    )
    await expect(playerFrame.locator("#primary-caption")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    )
    await expect(playerFrame.locator("#secondary-caption")).toHaveCSS(
      "color",
      "rgb(255, 224, 138)",
    )
    await expect(playerFrame.locator("#custom-captions")).toHaveCSS("gap", "8px")

    await playerDialog.getByRole("button", { name: "詳細資訊" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/about\?returnTo=/)
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(
      detail.getByRole("tab", { name: "關於影音" }),
    ).toHaveAttribute("aria-selected", "true")
  })
})
