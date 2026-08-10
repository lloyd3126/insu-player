import { expect, test } from "@playwright/test"

import { HomePage } from "../pages/home.page"

test.describe("library and details @critical", () => {
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
      await page.goto("/guide/getting-started", {
        waitUntil: "domcontentloaded",
      })
      await expect.poll(() => bundleRequested).toBe(true)
      const loading = page.getByRole("dialog", {
        name: "正在開啟使用說明",
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

    await expect(page.getByRole("dialog", { name: "使用說明" })).toBeVisible()
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
    await expect(page).toHaveURL(/\/library$/)
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }),
    ).toBeVisible()
    await expect(page).toHaveURL(
      /\/player\/demo-video\?caption=zh-TW&returnTo=%2Flibrary$/,
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

    const guide = await home.openNavigationDialog("使用說明", "使用說明")
    await guide.getByRole("tab", { name: "我的提示" }).click()
    await expect(page).toHaveURL(/\/guide\/my-prompts$/)
    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "使用說明" }).getByRole("tab", {
        name: "我的提示",
      }),
    ).toHaveAttribute("aria-selected", "true")

    await page.getByRole("dialog", { name: "使用說明" }).getByRole("button", {
      name: "關閉",
    }).click()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await expect(page).toHaveURL(/\/library\/list$/)
    const row = library.getByRole("row").filter({ hasText: "雙語測試影音" })
    await row.getByRole("button", { name: "雙語測試影音", exact: true }).click()
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "執行紀錄" }).click()
    await expect(page).toHaveURL(
      /\/jobs\/demo-video\/activity\?returnTo=%2Flibrary%2Flist$/,
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
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await library
      .getByRole("row")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "雙語測試影音", exact: true })
      .click()

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "畫質管理" }).click()
    await expect(page).toHaveURL(
      /\/jobs\/demo-video\/quality\?returnTo=%2Flibrary%2Flist$/,
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
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await expect(page).toHaveURL(/\/library\/list$/)

    const row = library.getByRole("row").filter({ hasText: "雙語測試影音" })
    await row.getByRole("button", { name: "觀看" }).click()
    const playerPath =
      "/player/demo-video?caption=zh-TW&returnTo=%2Flibrary%2Flist"
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
    const returnedLibrary = page.getByRole("dialog", { name: "影音中心" })
    await expect(returnedLibrary).toBeVisible()
    await expect(
      returnedLibrary.getByRole("tab", { name: "詳細資訊" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(page).toHaveURL(/\/library\/list$/)

    await returnedLibrary.getByRole("button", { name: "關閉" }).click()
    await expect(home.heroHeading).toBeVisible()
    await expect(page).toHaveURL(/\/$/)

    await page.goto("/player/demo-video?caption=zh-TW")
    const directPlayer = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(directPlayer).toBeVisible()
    await directPlayer.getByRole("button", { name: "關閉" }).click()
    await expect(page.getByRole("dialog", { name: "影音中心" })).toBeVisible()
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
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await library
      .getByRole("row")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "雙語測試影音", exact: true })
      .click()

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
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByRole("dialog", { name: "影音中心" })).toBeVisible()
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
    await expect(removeButton).toBeHidden()
    await card.hover()
    await expect(duration).toBeVisible()
    await expect(removeButton).toBeVisible()
    const thumbnailBox = await card.locator(".video-grid-card__thumbnail").boundingBox()
    const removeButtonBox = await removeButton.boundingBox()
    expect(removeButtonBox?.x).toBeGreaterThan(thumbnailBox?.x ?? 0)
    expect(removeButtonBox?.y).toBeGreaterThanOrEqual(thumbnailBox?.y ?? 0)
    expect(removeButtonBox?.x).toBeLessThanOrEqual(
      (thumbnailBox?.x ?? 0) + (thumbnailBox?.width ?? 0),
    )
    expect(removeButtonBox?.y).toBeLessThan(
      (thumbnailBox?.y ?? 0) + (thumbnailBox?.height ?? 0),
    )
    await removeButton.click()
    const removal = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    await expect(removal).toBeVisible()
    await expect(page).toHaveURL(/\/library$/)
    await removal.getByRole("button", { name: "取消" }).click()
    await expect(removal).toBeHidden()
    await expect(library.locator(".metrics")).not.toBeVisible()
    await expect(card.getByText("字幕重排", { exact: true })).toHaveCount(0)
    await expect(card.getByRole("combobox")).toHaveCount(0)
    const searchBox = await search.boundingBox()
    const panelMetrics = await mediaPanel.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        contentWidth:
          element.clientWidth - Number.parseFloat(style.paddingInlineEnd),
        gutterWidth: element.getBoundingClientRect().width - element.clientWidth,
        scrollbarGutter: style.scrollbarGutter,
      }
    })
    expect(searchBox?.width).toBeCloseTo(
      panelMetrics.contentWidth,
      0,
    )
    expect(panelMetrics.gutterWidth).toBeGreaterThan(0)
    expect(panelMetrics.scrollbarGutter).toBe("stable")
    const columnCount = await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    )
    expect(columnCount).toBeGreaterThan(0)
    expect(columnCount).toBeLessThanOrEqual(3)
  })

  test("defaults to the list tab when the center is empty", async ({ page }) => {
    await page.route("**/api/jobs", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobs: [], serverTime: new Date().toISOString() }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()

    await expect(
      library.getByRole("tab", { name: "詳細資訊" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(library.getByText("目前還沒有影音")).toBeVisible()
  })

  test("shows fixed media caption and action columns", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await expect(library.locator(".metrics")).toBeVisible()
    const table = library.getByRole("table")
    const row = table.getByRole("row").filter({ hasText: "雙語測試影音" })

    await expect(table.getByRole("columnheader")).toHaveCount(3)
    await expect(table.getByRole("columnheader", { name: "目前狀態" })).toHaveCount(0)
    await expect(table.getByRole("columnheader", { name: "操作" })).toBeVisible()
    await expect(library.getByText("01 / INSU COLLECTION", { exact: true })).toHaveCount(0)
    await expect(library.getByText("影音處理資訊", { exact: true })).toHaveCount(0)
    await expect(row.getByText("字幕重排", { exact: true })).toHaveCount(0)
    const detailsPanel = library.getByRole("tabpanel", { name: "詳細資訊" })
    const tableFrame = library.locator(".job-table-frame")
    await expect(detailsPanel).toHaveCSS("overflow-y", "hidden")
    await expect(tableFrame).toHaveCSS("overflow-y", "auto")
    await expect(tableFrame).toHaveCSS("scrollbar-gutter", "stable")
    const captions = row.getByRole("combobox", { name: "雙語測試影音 字幕" })
    await expect(captions).toContainText("zh-TW")
    await captions.click()
    await expect(page.getByRole("option", { name: "en" })).toBeVisible()
    await expect(page.getByRole("option", { name: "zh-TW" })).toBeVisible()
    await page.getByRole("option", { name: "en" }).click()
    await expect(captions).toContainText("en")
    expect(await table.evaluate((element) => getComputedStyle(element).tableLayout)).toBe("fixed")

    const watch = row.getByRole("button", { name: "觀看" })
    const settings = row.getByRole("button", { name: "設定" })
    const remove = row.getByRole("button", { name: "移除影音" })
    const titleLink = row.getByRole("button", {
      name: "雙語測試影音",
      exact: true,
    })
    const captionCell = row.locator('[data-label="字幕"]')
    const actionCell = row.locator('[data-label="操作"]')
    const videoCell = row.locator('[data-label="影音"]')
    const [
      watchBox,
      settingsBox,
      removeBox,
      captionsBox,
      captionCellBox,
      actionsBox,
      actionCellBox,
      videoCellBox,
    ] = await Promise.all([
      watch.boundingBox(),
      settings.boundingBox(),
      remove.boundingBox(),
      captions.boundingBox(),
      captionCell.boundingBox(),
      row.locator(".job-actions").boundingBox(),
      actionCell.boundingBox(),
      videoCell.boundingBox(),
    ])
    expect(watchBox?.width).toBeCloseTo(settingsBox?.width ?? 0, 0)
    expect(watchBox?.width).toBeCloseTo(removeBox?.width ?? 0, 0)
    expect(watchBox?.width).toBeCloseTo(watchBox?.height ?? 0, 0)
    expect(captionCellBox?.width).toBeCloseTo((captionsBox?.width ?? 0) + 16, 0)
    expect(actionCellBox?.width).toBeCloseTo((actionsBox?.width ?? 0) + 16, 0)
    expect(videoCellBox?.width).toBeGreaterThan(actionCellBox?.width ?? 0)
    await expect(watch).toHaveText("")
    await expect(row.getByRole("button", { name: "詳情" })).toHaveCount(0)
    const tooltip = page.locator('[data-slot="tooltip-content"][data-open]')
    await watch.hover()
    await expect(tooltip).toHaveText("觀看")
    await settings.hover()
    await expect(tooltip).toHaveText("設定")
    await titleLink.hover()
    await expect(titleLink).toHaveCSS("text-decoration-line", "underline")
    await remove.click()
    const removal = page.getByRole("alertdialog", {
      name: "完整移除此影音",
    })
    await expect(removal).toBeVisible()
    await removal.getByRole("button", { name: "取消" }).click()
    await expect(removal).toBeHidden()
    await settings.click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/about\?returnTo=/)
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }),
    ).toBeVisible()
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
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    const row = library.getByRole("row").filter({ hasText: "雙語測試影音" })
    await row.getByRole("button", { name: "雙語測試影音", exact: true }).click()

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(detail.getByRole("tab")).toHaveText([
      "關於影音",
      "畫質管理",
      "字幕管理",
      "影音摘要",
      "影音筆記",
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
    await expect(aboutPanel.getByText("狀態歷程", { exact: true })).toHaveCount(
      0,
    )
    await expect(
      aboutPanel.getByText("最新紀錄優先", { exact: true }),
    ).toHaveCount(0)
    const historyTable = aboutPanel.getByRole("table")
    await expect(historyTable.getByRole("columnheader")).toHaveText([
      "時間",
      "狀態",
      "訊息",
    ])
    const historyRows = historyTable.getByRole("row")
    await expect(historyRows).toHaveCount(3)
    await expect(historyRows.nth(1)).toContainText("字幕已完成")
    await expect(historyRows.nth(2)).toContainText("影音處理中")
    const historyViewport = aboutPanel.locator(
      '[data-slot="scroll-area-viewport"]',
    )
    await expect(historyViewport).toBeVisible()
    expect(
      await aboutPanel.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("hidden")
    expect(
      await historyViewport.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toMatch(/auto|scroll/)
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
    await expect(
      subtitlePanel.getByRole("heading", {
        name: "製作與更新字幕",
      }),
    ).toBeVisible()
    await expect(
      subtitlePanel.getByRole("region", {
        name: "播放字幕版本",
      }),
    ).toBeVisible()
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
    await expect(sourceActions).toHaveCount(2)
    await expect(sourceActions.nth(0)).toHaveAccessibleName("預覽原始字幕 r1")
    await expect(sourceActions.nth(1)).toHaveAccessibleName("移除原始字幕 r1")
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
    await expect(detail.getByText("影音摘要尚未設定")).toBeVisible()

    await detail.getByRole("tab", { name: "字幕管理" }).click()
    await subtitlePanel.getByRole("tab", { name: "翻譯字幕" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/subtitles\/translation/)
    const translatedPanel = subtitlePanel.getByRole("tabpanel", {
      name: "翻譯字幕",
    })
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

    await detail.getByRole("tab", { name: "影音筆記" }).click()
    await expect(detail.getByText("影音筆記尚未設定")).toBeVisible()

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
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await library
      .getByRole("row")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "雙語測試影音", exact: true })
      .click()
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

  test("switches the active subtitle revision from subtitle management", async ({
    page,
  }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await library
      .getByRole("row")
      .filter({ hasText: "雙語測試影音" })
      .getByRole("button", { name: "雙語測試影音", exact: true })
      .click()

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "字幕管理" }).click()
    const selector = detail.getByRole("combobox", { name: "en 播放版本" })
    await expect(selector).toContainText("en · 校正字幕 · r1")

    const selectSource = page.waitForRequest(
      (candidate) =>
        candidate.method() === "PUT" &&
        new URL(candidate.url()).pathname ===
          "/api/jobs/demo-video/subtitles/active",
    )
    await selector.click()
    await page.getByRole("option", { name: "en · 模型轉錄 · r1" }).click()
    expect((await selectSource).postDataJSON()).toEqual({
      languageCode: "en",
      trackId: "demo-video-source-model-transcript-en-r1-source_raw",
    })
    await expect(selector).toContainText("en · 模型轉錄 · r1")

    const restoreProofread = page.waitForRequest(
      (candidate) =>
        candidate.method() === "PUT" &&
        new URL(candidate.url()).pathname ===
          "/api/jobs/demo-video/subtitles/active",
    )
    await selector.click()
    await page.getByRole("option", { name: "en · 校正字幕 · r1" }).click()
    expect((await restoreProofread).postDataJSON()).toEqual({
      languageCode: "en",
      trackId: "demo-video-proofread-en-en-r1-output_sentence",
    })
    await expect(selector).toContainText("en · 校正字幕 · r1")
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

    await playerDialog.getByLabel("播放器字幕").click()
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
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    const row = library.getByRole("row").filter({ hasText: "雙語測試影音" })
    const captions = row.getByRole("combobox", { name: "雙語測試影音 字幕" })
    await captions.click()
    await page.getByRole("option", { name: "en" }).click()
    await row.getByRole("button", { name: "觀看" }).click()

    const playerDialog = page.getByRole("dialog", { name: "雙語測試影音" })
    const playerFrame = page.frameLocator('iframe[title="本機影音播放器"]')
    await expect(playerFrame.getByRole("region", { name: "本機影音播放器" })).toBeVisible()
    await expect(playerFrame.locator("video")).toBeVisible()
    await expect(
      playerDialog.getByRole("combobox", { name: "播放器字幕" }),
    ).toContainText("en")

    await playerDialog.getByRole("button", { name: "詳細資訊" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/about\?returnTo=/)
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(
      detail.getByRole("tab", { name: "關於影音" }),
    ).toHaveAttribute("aria-selected", "true")
  })
})
