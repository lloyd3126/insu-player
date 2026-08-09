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
    await expect(page).toHaveURL(/\/player\/demo-video\?caption=zh-TW$/)
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
    await row.getByRole("button", { name: "詳情" }).click()
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "處理紀錄" }).click()
    await expect(page).toHaveURL(/\/jobs\/demo-video\/activity$/)

    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "雙語測試影音" }).getByRole("tab", {
        name: "處理紀錄",
      }),
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
    await card.hover()
    await expect(duration).toBeVisible()
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

  test("shows fixed reusable columns and the subtitle stage in current status", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    await expect(library.locator(".metrics")).toBeVisible()
    const table = library.getByRole("table")
    const row = table.getByRole("row").filter({ hasText: "雙語測試影音" })

    await expect(table.getByRole("columnheader")).toHaveCount(4)
    await expect(table.getByRole("columnheader", { name: "目前狀態" })).toBeVisible()
    await expect(row.getByText("字幕重排", { exact: true })).toBeVisible()
    const captions = row.getByRole("combobox", { name: "雙語測試影音 字幕" })
    await expect(captions).toContainText("zh-TW")
    await captions.click()
    await expect(page.getByRole("option", { name: "en" })).toBeVisible()
    await expect(page.getByRole("option", { name: "zh-TW" })).toBeVisible()
    await page.getByRole("option", { name: "en" }).click()
    await expect(captions).toContainText("en")
    expect(await table.evaluate((element) => getComputedStyle(element).tableLayout)).toBe("fixed")

    const watch = row.getByRole("button", { name: "觀看" })
    const detail = row.getByRole("button", { name: "詳情" })
    const [watchBox, detailBox] = await Promise.all([
      watch.boundingBox(),
      detail.boundingBox(),
    ])
    expect(watchBox?.width).toBeCloseTo(detailBox?.width ?? 0, 0)
  })

  test("separates media facts subtitles segmentation and processing records", async ({ page }) => {
    let captionRequests = 0
    let logRequests = 0
    page.on("request", (request) => {
      const url = request.url()
      if (url.includes("/api/jobs/demo-video/captions")) captionRequests += 1
      if (url.includes("/api/jobs/demo-video/log")) logRequests += 1
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await library.getByRole("tab", { name: "詳細資訊" }).click()
    const row = library.getByRole("row").filter({ hasText: "雙語測試影音" })
    await row.getByRole("button", { name: "詳情" }).click()

    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(detail.getByRole("tab")).toHaveCount(4)
    await expect(detail.getByRole("tab", { name: "關於" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(detail.getByText("來源", { exact: true })).toBeVisible()
    await expect(detail.getByText("時長", { exact: true })).toBeVisible()
    await expect(detail.getByText("容量", { exact: true })).toBeVisible()
    await expect(detail.getByText("更新時間", { exact: true })).toBeVisible()
    const aboutPanel = detail.getByRole("tabpanel", { name: "關於" })
    await expect(aboutPanel.getByText("狀態歷程", { exact: true })).toBeVisible()
    await expect(aboutPanel.getByText("最新紀錄優先", { exact: true })).toBeVisible()
    const historyViewport = aboutPanel.locator(
      '[data-slot="scroll-area-viewport"]',
    )
    await expect(historyViewport).toBeVisible()
    expect(await aboutPanel.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
      "hidden",
    )
    expect(
      await historyViewport.evaluate((element) => getComputedStyle(element).overflowY),
    ).toMatch(/auto|scroll/)
    await expect(detail.getByText("Workflow log", { exact: true })).toHaveCount(0)
    expect(captionRequests).toBe(0)
    expect(logRequests).toBe(0)

    await detail.getByRole("tab", { name: "字幕" }).click()
    await expect(detail.getByText("字幕", { exact: true }).last()).toBeVisible()
    await expect(detail.getByText("轉錄模型", { exact: true })).toBeVisible()
    await expect(detail.getByText("字幕流程", { exact: true })).toBeVisible()
    const comparison = detail.getByRole("table")
    await expect(comparison.getByRole("columnheader", { name: "en" })).toBeVisible()
    await expect(comparison.getByRole("columnheader", { name: "zh-TW" })).toBeVisible()
    const longEnglishCue = comparison.getByText(
      /For the last month I have been experimenting/,
    )
    await expect(longEnglishCue).toBeVisible()
    await expect(
      comparison.getByText(/過去一個月我一直在嘗試 Vibe Coding/),
    ).toBeVisible()
    expect(
      await longEnglishCue.evaluate((element) =>
        getComputedStyle(element).whiteSpace,
      ),
    ).toBe("normal")
    await expect.poll(() => captionRequests).toBe(1)
    expect(logRequests).toBe(0)

    await detail.getByRole("tab", { name: "切分" }).click()
    await expect(detail.getByText("切分檢視尚未設定")).toBeVisible()

    await detail.getByRole("tab", { name: "處理紀錄" }).click()
    const activityPanel = detail.getByRole("tabpanel", { name: "處理紀錄" })
    await expect(activityPanel.getByText("狀態歷程", { exact: true })).toHaveCount(0)
    await expect(activityPanel.getByText("Workflow log", { exact: true })).toBeVisible()
    await expect(activityPanel.getByText("最近 180 行", { exact: true })).toBeVisible()
    await expect(activityPanel.getByText("download complete", { exact: false })).toBeVisible()
    await expect.poll(() => logRequests).toBe(1)
    const [panelBox, logBox] = await Promise.all([
      activityPanel.boundingBox(),
      activityPanel.locator(".workflow-log-card").boundingBox(),
    ])
    expect(logBox?.width ?? 0).toBeGreaterThan((panelBox?.width ?? 0) * 0.9)
  })

  test("virtualizes a long bilingual caption timeline", async ({ page }) => {
    const rows = Array.from({ length: 240 }, (_, index) => ({
      id: `en:${index}`,
      start: index * 2,
      end: index * 2 + 2,
      cues: {
        en: `English sentence ${index + 1}`,
        "zh-TW": `繁中句子 ${index + 1}`,
      },
    }))
    await page.route("**/api/jobs/demo-video/captions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          videoId: "demo-video",
          baselineLanguage: "en",
          tracks: [
            { code: "en", label: "English", cueCount: rows.length },
            { code: "zh-TW", label: "繁體中文", cueCount: rows.length },
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
      .getByRole("button", { name: "詳情" })
      .click()
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await detail.getByRole("tab", { name: "字幕" }).click()

    const table = detail.getByRole("table")
    const viewport = detail.locator(".caption-table-frame")
    await expect(table).toHaveAttribute("aria-rowcount", "241")
    await expect(table.getByText("English sentence 1", { exact: true })).toBeVisible()
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
    const saved: Array<{ path: string; time: number; duration: number | null }> = []
    await page.route(/\/api\/jobs\/[^/]+\/playback$/, async (route) => {
      const payload = route.request().postDataJSON() as {
        time: number
        duration: number | null
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
    await playerDialog.getByRole("button", { name: "查看處理紀錄" }).click()
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

    await playerDialog.getByRole("button", { name: "查看處理紀錄" }).click()
    const detail = page.getByRole("dialog", { name: "雙語測試影音" })
    await expect(detail.getByRole("tab", { name: "關於" })).toBeVisible()
  })
})
