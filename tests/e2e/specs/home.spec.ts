import { expect, test } from "@playwright/test"

import { HomePage } from "../pages/home.page"
import {
  BUILT_IN_PROMPTS,
  CHECK_SOURCE_SUPPORT_PROMPT,
  buildAddVideoPrompt,
} from "../../../src/shared/prompts/insu-prompts"
import {
  EXTENSION_CONNECTION_PROTOCOL_VERSION,
} from "../../../src/shared/contracts/browser-extension"

test.describe("INSU Player home @smoke", () => {
  test("shows seven ordered text-only navigation destinations", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()

    await expect(page).toHaveTitle("INSU Player")
    await expect(home.navigation).toBeVisible()
    await expect(page.getByRole("status")).toContainText("本機服務已連線")

    const artwork = page.locator(".hero-artwork > img")
    await expect(artwork).toHaveCount(1)
    await expect(artwork).toBeVisible()
    await expect(page.locator(".hero-orbit, .orbit-label, .noise")).toHaveCount(0)
    await expect(page.locator(".last-updated")).toHaveCount(0)
    expect(
      await page.locator(".app-shell").evaluate((element) =>
        getComputedStyle(element).backgroundColor,
      ),
    ).toBe("rgb(18, 18, 18)")
    expect(
      await page.locator(".hero h1").evaluate((element) => {
        const style = getComputedStyle(element)
        return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize)
      }),
    ).toBeGreaterThan(1)

    const navigationLinks = home.navigation.getByRole("link")
    await expect(navigationLinks).toHaveCount(7)
    await expect(navigationLinks).toHaveText([
      "開始說明",
      "我的提示",
      "轉錄設定",
      "支援網站",
      "擴充功能",
      "異常回報",
      /影片中心/,
    ])
    await expect(home.navigation.locator("svg")).toHaveCount(1)
    await expect(
      home.navigation.getByRole("link", { name: /影片中心/ }).locator("svg"),
    ).toHaveCount(1)
    await expect(
      home.navigation.getByRole("link", { name: "開始說明" }).locator("svg"),
    ).toHaveCount(0)
    await expect(
      home.navigation.getByRole("link", { name: "功能設定" }),
    ).toHaveCount(0)
    await expect(
      home.navigation.getByRole("link", { name: "開始使用", exact: true }),
    ).toHaveCount(0)
    await expect(
      home.navigation.getByRole("link", { name: "介面設定" }),
    ).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })

  test("guides a privacy-safe issue report from diagnosis to GitHub", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()
    await page.context().grantPermissions([
      "clipboard-read",
      "clipboard-write",
    ])

    const report = await home.openNavigationDialog("異常回報", "異常回報")
    await expect(report.getByRole("tab")).toHaveText([
      "1 偵查問題",
      "2 檢查回報",
      "3 建立 Issue",
    ])
    await report.getByRole("button", { name: "複製偵查提示" }).click()
    const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText())
    expect(copiedPrompt).toContain("只進行唯讀偵查")
    expect(copiedPrompt).toContain("不得讀取、顯示或回報 API Key")

    await report.getByRole("button", { name: "前往檢查回報" }).click()
    await expect(page).toHaveURL(/\/report\/review$/)
    await expect(
      report.getByRole("heading", { name: "檢查 Agent 整理的回報" }),
    ).toBeVisible()

    await report.getByRole("button", { name: "前往建立 Issue" }).click()
    await expect(page).toHaveURL(/\/report\/submit$/)
    await expect(
      report.getByRole("link", { name: "前往 GitHub 建立 Issue" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/lloyd3126/insu-player/issues/new",
    )
  })

  test("adds media from the homepage and shows it directly in the library", async ({ page }) => {
    const pendingItem = {
      kind: "download",
      id: "library-demo",
      sourceKind: "page",
      pageUrl: "https://www.youtube.com/watch?v=demo-video",
      sourceUrl: "https://www.youtube.com/watch?v=demo-video",
      videoId: null,
      title: "youtube.com",
      thumbnailUrl: null,
      state: "queued",
      stage: "awaiting-download",
      progress: 0,
      message: "等待下載",
      errorCode: null,
      queueAhead: 0,
      lowQualityApproved: false,
      authentication: "none",
      authenticationConsentAt: null,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      completedAt: null,
    }
    await page.route("**/api/library/items", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true, itemIds: [pendingItem.id] }),
      }),
    )
    await page.route("**/api/library", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [pendingItem],
          queue: {
            paused: false,
            concurrency: 2,
            queuedCount: 1,
            activeCount: 0,
            attentionCount: 0,
          },
          serverTime: "2026-08-11T00:00:00Z",
        }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()

    await page.getByRole("link", { name: "加入影音" }).click()
    const dialog = page.getByRole("dialog", { name: "影片中心" })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/library\/list$/)
    await expect(dialog.getByRole("tab", { name: "下載佇列" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(
      dialog.getByRole("heading", { name: "下載影音" }),
    ).toBeVisible()
    await expect(dialog.getByLabel("單支影音網址")).toBeVisible()
    await expect(
      dialog.getByText(
        "點擊下載按鈕代表有權下載、轉錄與觀看這項內容，還是無法下載的話請使用擴充程式嘗試。",
      ),
    ).toBeVisible()
    await dialog.getByLabel("單支影音網址").fill(
      "https://www.youtube.com/watch?v=demo-video",
    )
    await expect(dialog.getByRole("checkbox")).toHaveCount(0)
    await dialog.getByRole("button", { name: "下載", exact: true }).click()
    await expect(page).toHaveURL(/\/library\/list(?:\?|$)/)
    const library = page.getByRole("dialog", { name: "影片中心" })
    await expect(library.getByRole("tab", { name: "下載佇列" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(library.getByText("youtube.com", { exact: true })).toBeVisible()
    await expect(library.getByText("0%", { exact: true })).toBeVisible()
    await expect(
      library.getByRole("link", { name: "開啟來源 youtube.com" }),
    ).toHaveAttribute("href", "https://www.youtube.com/watch?v=demo-video")
    await expect(
      library.getByRole("button", { name: "開始下載 youtube.com" }),
    ).toBeVisible()
    await expect(
      library.getByRole("button", { name: "移除任務 youtube.com" }),
    ).toBeVisible()
    await expect(library.getByText("等待下載", { exact: true })).toHaveCount(0)
    await expect(library.getByText("下一個開始下載")).toHaveCount(0)
    await expect(library.getByText(pendingItem.pageUrl, { exact: true })).toHaveCount(0)
    await expect(library.getByLabel("下載排程")).toHaveCount(0)
    await page.reload()
    await expect(page).toHaveURL(/\/library\/list(?:\?|$)/)
    await expect(page.getByRole("dialog", { name: "影片中心" })).toBeVisible()
  })

  test("returns to the homepage when the homepage library dialog closes", async ({ page }) => {
    const home = new HomePage(page)
    await home.goto()

    await page.getByRole("link", { name: "加入影音" }).click()
    const dialog = page.getByRole("dialog", { name: "影片中心" })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/library\/list$/)

    await dialog.getByRole("button", { name: "關閉" }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(dialog).toBeHidden()
  })

  test("keeps the last library state visible when one progress refresh fails", async ({ page }) => {
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
    let reads = 0
    await page.route("**/api/library", (route) => {
      reads += 1
      if (reads === 1) {
        return route.fulfill({
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
        })
      }
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary read failure" }),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    await home.navigation.getByRole("link", { name: /影片中心/ }).click()
    const library = page.getByRole("dialog", { name: "影片中心" })
    await library.getByRole("tab", { name: "下載佇列" }).click()
    const row = library.getByRole("row").filter({ hasText: "Active Video" })
    await expect(row.getByLabel("下載進度 45%")).toBeVisible()
    await expect(
      row.getByRole("link", { name: "開啟來源 Active Video" }),
    ).toHaveAttribute("href", activeItem.pageUrl)
    await expect(row.getByText(activeItem.pageUrl, { exact: true })).toHaveCount(0)
    await expect(row.getByText(activeItem.message, { exact: true })).toHaveCount(0)
    await expect(row.getByRole("progressbar")).toHaveCount(0)
    await expect(library.getByLabel("下載排程")).toHaveCount(0)
    await expect(library.getByText("temporary read failure")).toBeVisible({
      timeout: 10_000,
    })
    await expect(row.getByText("Active Video", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/library\/list$/)
  })

  test("keeps failed work in the queue with start and removal actions", async ({ page }) => {
    const failedItem = {
      kind: "download",
      id: "library-failed",
      sourceKind: "page",
      pageUrl: "https://example.test/failed-video",
      sourceUrl: "https://example.test/failed-video",
      videoId: null,
      title: "Failed Video",
      thumbnailUrl: null,
      state: "failed",
      stage: "media-download",
      progress: 0,
      message: "影音下載失敗",
      errorCode: "download-failed",
      queueAhead: null,
      lowQualityApproved: false,
      authentication: "none",
      authenticationConsentAt: null,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:01:00Z",
      completedAt: "2026-08-11T00:01:00Z",
    }
    let removed = false
    const response = () => ({
      items: removed ? [] : [failedItem],
      queue: {
        paused: false,
        concurrency: 2,
        queuedCount: 0,
        activeCount: 0,
        attentionCount: removed ? 0 : 1,
      },
      serverTime: "2026-08-11T00:02:00Z",
    })
    await page.route("**/api/library", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response()),
      }),
    )
    await page.route("**/api/library/items/library-failed", (route) => {
      expect(route.request().method()).toBe("DELETE")
      removed = true
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response()),
      })
    })

    const home = new HomePage(page)
    await home.goto()
    const library = await home.openLibrary()
    await expect(library.getByRole("tab", { name: "下載佇列" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const row = library.getByRole("row").filter({ hasText: "Failed Video" })
    await expect(
      row.getByRole("button", { name: "開始下載 Failed Video" }),
    ).toBeVisible()
    await row
      .getByRole("button", { name: "移除任務 Failed Video" })
      .click()
    await expect(library.getByText("目前沒有下載工作")).toBeVisible()
  })

  test("keeps each getting-started section in its own tab", async ({ page }) => {
    await page.context().grantPermissions([
      "clipboard-read",
      "clipboard-write",
    ])
    await page.route("**/api/prompts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          version: 1,
          prompts: [
            {
              id: "review-bilingual",
              title: "複習雙語字幕",
              scenario: "在觀看後複習英文與繁中字幕",
              prompt: "請幫我整理這支影音的雙語複習重點",
              updatedAt: "2026-08-09T00:00:00Z",
            },
          ],
        }),
      }),
    )
    await page.route("**/api/supported-sites", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "yt-dlp",
          available: true,
          version: "2026.08.09",
          count: 120,
          extractors: Array.from(
            { length: 120 },
            (_, index) => `example-${String(index + 1).padStart(3, "0")}`,
          ),
          message: "",
        }),
      }),
    )
    await page.route("**/api/runtime", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          initialized: true,
          capabilities: [
            ["database", "影音庫資料庫", "SQLite 已建立"],
            ["bun", "網頁執行環境", "Bun 已安裝在 workspace"],
            ["python", "影音處理套件", "影音處理套件已安裝在 workspace"],
            ["ffmpeg", "影音轉換工具", "FFmpeg 已安裝在 workspace"],
            ["yt-dlp", "來源下載工具", "yt-dlp 已安裝在 workspace"],
            ["whisper", "本機語音辨識", "Whisper 已安裝在 workspace"],
            ["whisper-medium", "本機逐字時間模型", "Whisper medium 已下載"],
          ].map(([key, label, detail]) => ({
            key,
            label,
            detail,
            state: "ready",
            version: null,
            checkedAt: "2026-08-11T00:00:00Z",
          })),
          activeSetup: null,
        }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()

    const guide = await home.openNavigationDialog("開始說明", "開始說明")
    await expect(guide.getByRole("tab")).toHaveCount(3)
    await expect(guide.getByRole("tab", { name: "我的提示" })).toHaveCount(0)
    await expect(guide.getByRole("tab", { name: "支援網站" })).toHaveCount(0)
    await expect(guide.getByRole("tab", { name: "使用情境" })).toHaveCount(0)
    await expect(
      guide.getByRole("heading", { name: "INSU Player 已準備完成" }),
    ).toBeVisible()
    const firstContentTop = async (tabName: string) => {
      const panel = guide.getByRole("tabpanel", { name: tabName })
      await expect(
        guide.locator('[role="tabpanel"]:visible'),
      ).toHaveCount(1)
      await expect(panel).toBeVisible()
      return panel
        .locator(".guide-tab-content > :first-child")
        .evaluate((element) => element.getBoundingClientRect().top)
    }
    const tabStartTops = [await firstContentTop("1 初始化")]
    await expect(guide.locator('[role="tabpanel"]:visible > * > *')).toHaveCount(1)

    await guide.getByRole("button", { name: "前往加入影音" }).click()
    await expect(page).toHaveURL(/\/guide\/add-media$/)
    await expect
      .poll(async () =>
        Math.abs((await firstContentTop("2 加入影音")) - tabStartTops[0]),
      )
      .toBeLessThan(2)
    tabStartTops.push(await firstContentTop("2 加入影音"))
    await expect(
      guide.getByRole("heading", { name: "加入一支影音" }),
    ).toBeVisible()
    await expect(
      guide.getByText(
        "貼上影音網址並複製提示，接下來只需要用一般語言回答想要哪種字幕。",
      ),
    ).toBeVisible()

    const usageCallout = guide.locator(".usage-layout > .prompt-action-card")
    await expect(usageCallout).toBeVisible()
    const videoUrl = "https://www.youtube.com/watch?v=demo-video"
    const videoUrlInput = usageCallout.getByLabel("影音網址")
    const addVideoCopy = usageCallout.locator(
      '[data-slot="card-action"] [data-slot="button"]',
    )
    await expect(addVideoCopy).toHaveAccessibleName("複製加入提示")
    await expect(addVideoCopy).toBeDisabled()
    await videoUrlInput.fill("not-a-url")
    await expect(usageCallout.getByRole("alert")).toContainText(
      "完整的 http 或 https",
    )
    await videoUrlInput.fill(videoUrl)
    await expect(usageCallout.getByRole("alert")).toHaveCount(0)
    await expect(addVideoCopy).toBeEnabled()
    await addVideoCopy.click()
    await expect(addVideoCopy).toHaveText("已複製")
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(buildAddVideoPrompt(videoUrl))
    await expect(usageCallout).not.toContainText("VIDEO_ID")
    await expect(usageCallout).not.toContainText("VIDEO_URL")
    await expect(
      usageCallout.getByRole("button", { name: "前往交給 Agent" }),
    ).toBeVisible()
    await expect(guide.locator('[role="tabpanel"]:visible > * > *')).toHaveCount(1)
    await expect(guide.locator(".tutorial-card")).toHaveCount(0)
    const usageCopy = await usageCallout.boundingBox()
    const usageAction = await usageCallout
      .getByRole("button", { name: /已複製|複製加入提示/ })
      .boundingBox()
    expect(usageCopy).not.toBeNull()
    expect(usageAction).not.toBeNull()
    expect(usageAction!.x).toBeGreaterThan(usageCopy!.x + usageCopy!.width / 2)
    expect(usageAction!.y).toBeLessThan(usageCopy!.y + usageCopy!.height / 3)

    await usageCallout.getByRole("button", { name: "前往交給 Agent" }).click()
    await expect(page).toHaveURL(/\/guide\/handoff$/)
    tabStartTops.push(await firstContentTop("3 交給 Agent"))
    await expect(guide.locator('[role="tabpanel"]:visible > * > *')).toHaveCount(1)
    await expect(guide.locator(".tutorial-card")).toHaveCount(1)
    await expect(
      guide.getByRole("heading", { name: "把提示交給 Agent" }),
    ).toBeVisible()
    await expect(guide.locator(".tutorial-step-list > li")).toHaveCount(4)

    expect(
      Math.max(...tabStartTops) - Math.min(...tabStartTops),
      `tab starts: ${tabStartTops.join(", ")}`,
    ).toBeLessThan(2)
    await guide.getByRole("button", { name: "關閉", exact: true }).click()

    const myPromptsDialog = await home.openNavigationDialog(
      "我的提示",
      "我的提示",
    )
    await expect(page).toHaveURL(/\/prompts$/)
    const myPromptsBody = myPromptsDialog.locator(".app-dialog__body")
    const myPrompts = myPromptsDialog.locator(".advanced-section")
    const myPromptsCallout = myPrompts.locator(":scope > .prompt-action-card")
    const myPromptsScrollRegion = myPrompts.locator(
      ":scope > .my-prompts-scroll-region",
    )
    await expect(myPromptsBody).toHaveClass(/app-dialog__body--tabbed/)
    expect(
      await myPromptsBody.evaluate((element) => getComputedStyle(element).overflowY),
    ).toBe("hidden")
    expect(
      await myPromptsScrollRegion.evaluate(
        (element) => getComputedStyle(element).scrollbarGutter,
      ),
    ).toBe("stable")
    expect(
      await myPromptsScrollRegion.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("auto")
    const calloutTop = await myPromptsCallout.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    const panelScroll = await myPromptsScrollRegion.evaluate((element) => {
      const max = element.scrollHeight - element.clientHeight
      element.scrollTop = max
      return { max, actual: element.scrollTop }
    })
    expect(panelScroll.max).toBeGreaterThan(0)
    expect(panelScroll.actual).toBeGreaterThan(0)
    expect(
      await myPromptsBody.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeLessThanOrEqual(1)
    expect(
      await myPromptsCallout.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ).toBeCloseTo(calloutTop, 0)
    await myPromptsScrollRegion.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(
      myPromptsDialog.getByRole("heading", { name: BUILT_IN_PROMPTS[0].title }),
    ).toBeVisible()
    await expect(myPromptsDialog.getByText("READY TO COPY")).toHaveCount(0)
    await expect(myPromptsDialog.getByText("BUILT-IN PLAYBOOK")).toHaveCount(0)
    await expect(myPromptsCallout).toBeVisible()
    const promptCardList = myPromptsScrollRegion.locator(
      ":scope > .prompt-action-card-list",
    )
    const promptCards = promptCardList.locator(".prompt-action-card--compact")
    await expect(promptCards).toHaveCount(BUILT_IN_PROMPTS.length)
    const [calloutBox, promptListBox] = await Promise.all([
      myPromptsCallout.boundingBox(),
      promptCardList.boundingBox(),
    ])
    expect(calloutBox).not.toBeNull()
    expect(promptListBox).not.toBeNull()
    expect(promptListBox!.y).toBeGreaterThanOrEqual(
      calloutBox!.y + calloutBox!.height,
    )
    expect(
      await promptCardList.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(1)
    const promptWidths = await promptCardList.evaluate((element) => ({
      list: element.getBoundingClientRect().width,
      cards: Array.from(element.children, (child) =>
        child.getBoundingClientRect().width,
      ),
    }))
    expect(
      promptWidths.cards.every(
        (width) => Math.abs(width - promptWidths.list) < 1,
      ),
    ).toBe(true)
    const createPrompt = myPromptsCallout.getByRole("button")
    await expect(createPrompt).toBeVisible()
    await expect(createPrompt).toHaveText("複製提示")
    const reusablePrompt = myPrompts.locator(".reusable-prompt-card")
    await expect(reusablePrompt).toHaveCount(1)
    const [reusableBox, reusableAction] = await Promise.all([
      reusablePrompt.boundingBox(),
      reusablePrompt.getByRole("button", { name: "複製提示" }).boundingBox(),
    ])
    expect(reusableBox).not.toBeNull()
    expect(reusableAction).not.toBeNull()
    expect(reusableAction!.x).toBeGreaterThan(
      reusableBox!.x + reusableBox!.width / 2,
    )
    expect(reusableAction!.y).toBeLessThan(
      reusableBox!.y + reusableBox!.height / 3,
    )
    await createPrompt.click()
    await expect(createPrompt).toHaveText("已複製")
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("請和我一起建立一則可重用的 INSU Player 提示")

    await myPromptsDialog.getByRole("button", { name: "關閉", exact: true }).click()

    const supportedSitesDialog = await home.openNavigationDialog(
      "支援網站",
      "支援網站",
    )
    await expect(page).toHaveURL(/\/supported-sites$/)
    await expect(supportedSitesDialog.getByRole("tab")).toHaveCount(0)
    await expect(supportedSitesDialog.getByText("CURRENT COVERAGE")).toHaveCount(0)
    await expect(
      supportedSitesDialog.getByText("INSU Player 的來源支援由"),
    ).toHaveCount(0)
    await expect(supportedSitesDialog.getByText("詢問 Agent 是否支援")).toBeVisible()
    await expect(supportedSitesDialog.getByText("研究還沒支援的平台")).toHaveCount(0)
    await expect(supportedSitesDialog.getByText("更新 yt-dlp", { exact: true })).toHaveCount(0)
    const supportedSitesPanel = supportedSitesDialog.locator(".app-dialog__body")
    const sourceSupportCard = supportedSitesPanel.locator(
      ".guide-tab-content > .prompt-action-card",
    )
    await expect(sourceSupportCard).toHaveCount(1)
    await expect(sourceSupportCard).toBeVisible()
    await expect(
      supportedSitesPanel.locator(".prompt-action-card--compact"),
    ).toHaveCount(0)
    const supportedSearch = supportedSitesDialog.getByRole("searchbox", {
      name: "搜尋支援網站",
    })
    const [supportedCardsBox, supportedSearchBox] = await Promise.all([
      sourceSupportCard.boundingBox(),
      supportedSearch.boundingBox(),
    ])
    expect(supportedCardsBox).not.toBeNull()
    expect(supportedSearchBox).not.toBeNull()
    expect(supportedCardsBox!.y + supportedCardsBox!.height).toBeLessThanOrEqual(
      supportedSearchBox!.y,
    )
    const supportedSitesContent = supportedSitesPanel.locator(
      ".supported-sites-content",
    )
    const supportedSiteList = supportedSitesPanel.locator(".source-list")
    await expect(supportedSiteList).toBeVisible()
    expect(
      await supportedSitesPanel.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("hidden")
    expect(
      await supportedSitesContent.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("hidden")
    expect(
      await supportedSiteList.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("auto")
    const scrollBoundaries = await supportedSitesPanel.evaluate((panel) => {
      const list = panel.querySelector<HTMLElement>(".source-list")!
      const panelRect = panel.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const max = list.scrollHeight - list.clientHeight
      list.scrollTop = max
      return {
        panelOverflow: panel.scrollHeight - panel.clientHeight,
        listBottom: listRect.bottom,
        panelBottom: panelRect.bottom,
        listMax: max,
        listActual: list.scrollTop,
      }
    })
    expect(scrollBoundaries.panelOverflow).toBeLessThanOrEqual(1)
    expect(scrollBoundaries.listBottom).toBeLessThanOrEqual(
      scrollBoundaries.panelBottom + 1,
    )
    expect(scrollBoundaries.listMax).toBeGreaterThan(0)
    expect(scrollBoundaries.listActual).toBeGreaterThan(0)
    await expect(
      supportedSiteList.getByRole("listitem", { name: "example-120" }),
    ).toBeVisible()
    expect(await supportedSiteList.getByRole("listitem").count()).toBeLessThan(120)
    await sourceSupportCard.getByRole("button", { name: "複製提示" }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(CHECK_SOURCE_SUPPORT_PROMPT.split("\n")[0])
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("若更新後仍不支援，再研究 yt-dlp")
    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "支援網站" }),
    ).toBeVisible()
  })

  test("opens Chrome extension guidance in its own three-tab modal", async ({ page }) => {
    let paired = false
    await page.route(/\/api\/extension\/pairing$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
          paired,
          extensionOrigin: paired ? "chrome-extension://insu-player" : null,
          pairedAt: paired ? "2026-08-11T00:00:00Z" : null,
          lastSeenAt: paired ? "2026-08-11T00:00:00Z" : null,
          serverOrigin: "http://127.0.0.1:8000",
          libraryUrl: "http://127.0.0.1:8000/extension/library",
        }),
      }),
    )
    await page.route("**/api/extension/package", (route) => {
      expect(route.request().method()).toBe("POST")
      return route.fulfill({
        status: 200,
        body: "zip",
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="insu-player-extension-v0.3.2.zip"',
        },
      })
    })
    const home = new HomePage(page)
    await home.goto()

    const extension = await home.openNavigationDialog(
      "擴充功能",
      "Chrome 擴充功能",
    )
    await expect(page).toHaveURL(/\/extension\/download$/)
    await expect(extension.getByRole("tab")).toHaveCount(3)
    await expect(extension.getByRole("tab")).toHaveText([
      "1 下載",
      "2 安裝與連接",
      "3 使用",
    ])
    await expect(
      extension.getByRole("heading", { name: "下載已設定的 Chrome 擴充功能" }),
    ).toBeVisible()
    const packageDownload = page.waitForEvent("download")
    await extension.getByRole("button", { name: "下載 Chrome 擴充功能" }).click()
    expect((await packageDownload).suggestedFilename()).toBe(
      "insu-player-extension-v0.3.2.zip",
    )
    await expect(extension.getByRole("button", { name: /配對檔/ })).toHaveCount(0)

    await extension.getByRole("button", {
      name: "前往安裝與連接",
    }).click()
    await expect(page).toHaveURL(/\/extension\/connect$/)
    await expect(
      extension.getByRole("heading", { name: "安裝後自動連接" }),
    ).toBeVisible()
    await expect(extension).toContainText("不需要選擇任何檔案")
    paired = true
    await expect(
      extension.getByRole("heading", { name: "Chrome 已連接" }),
    ).toBeVisible({ timeout: 5_000 })
    await extension.getByRole("button", { name: "前往使用" }).click()

    await expect(page).toHaveURL(/\/extension\/usage$/)
    await expect(
      extension.getByRole("heading", { name: "Chrome 擴充功能已可使用" }),
    ).toBeVisible()
    await expect(extension).toContainText("iframe、MP4 與已結束的 M3U8")
    await page.reload()
    await expect(
      page.getByRole("dialog", { name: "Chrome 擴充功能" }),
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "3 使用" }),
    ).toHaveAttribute("aria-selected", "true")
  })

  test("manages local and cloud transcription models in one current table", async ({ page }) => {
    let selectedModelId = "local.openai-whisper.medium"
    let openAiConfigured = false
    const provider = () => ({
      id: "openai",
      displayName: "OpenAI",
      credentialName: "OPENAI_API_KEY",
      configured: openAiConfigured,
      source: openAiConfigured ? "session" : null,
      sdkInstalled: true,
      modelIds: ["cloud.openai.whisper-1"],
    })
    const localModels = Array.from({ length: 12 }, (_, index) => {
      const model = index === 0 ? "medium" : `test-${index + 1}`
      const installed = index === 0
      return {
        id: `local.openai-whisper.${model}`,
        type: "local" as const,
        displayName: index === 0 ? "OpenAI Whisper medium" : `OpenAI Whisper ${model}`,
        provider: "local" as const,
        providerName: "OpenAI Whisper",
        service: "openai-whisper",
        model,
        timingUnitKind: "word" as const,
        selected: selectedModelId === `local.openai-whisper.${model}`,
        ready: installed,
        status: installed ? "ready" as const : "not-downloaded" as const,
        requiresAudioUpload: false,
        requiresPerRunConsent: false,
        local: {
          runtimeInstalled: true,
          languageSupport: "multilingual" as const,
          approximateBytes: 512 * 1024 * 1024,
          memoryLabel: "約 2 GB",
          installed,
          valid: installed,
          sizeBytes: installed ? 512 * 1024 * 1024 : null,
          download: {
            state: "idle" as const,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 512 * 1024 * 1024,
            message: installed ? "可使用" : "尚未下載",
            errorCode: null,
          },
        },
      }
    })
    const cloudModels = Array.from({ length: 6 }, (_, index) => ({
      id: index === 0 ? "cloud.openai.whisper-1" : `cloud.openai.test-${index + 1}`,
      type: "cloud" as const,
      displayName: index === 0 ? "OpenAI whisper-1" : `OpenAI cloud test ${index + 1}`,
      provider: "openai" as const,
      providerName: "OpenAI",
      service: "audio/transcriptions",
      model: index === 0 ? "whisper-1" : `test-${index + 1}`,
      timingUnitKind: "word" as const,
      selected: selectedModelId === (index === 0 ? "cloud.openai.whisper-1" : `cloud.openai.test-${index + 1}`),
      ready: openAiConfigured,
      status: openAiConfigured ? "ready" as const : "credential-missing" as const,
      requiresAudioUpload: true,
      requiresPerRunConsent: true,
      cloud: {
        sdkInstalled: true,
        credentialConfigured: openAiConfigured,
        credentialName: "OPENAI_API_KEY",
        uploadDescription: "音訊分段會上傳到 OpenAI 語音辨識服務",
      },
    }))
    const modelsPayload = () => ({
      models: [...localModels, ...cloudModels].map((model) => ({
        ...model,
        selected: model.id === selectedModelId,
        ...(model.type === "cloud"
          ? {
              ready: openAiConfigured,
              status: openAiConfigured ? "ready" : "credential-missing",
              cloud: { ...model.cloud, credentialConfigured: openAiConfigured },
            }
          : {}),
      })),
      providers: [provider()],
      selectedModelId,
      updatedAt: "2026-08-11T00:00:00.000Z",
    })
    await page.route(/\/api\/models(?:\/[^/?]+)?$/, async (route) => {
      const url = new URL(route.request().url())
      const suffix = url.pathname.slice("/api/models/".length)
      if (url.pathname === "/api/models/selection") {
        expect(route.request().method()).toBe("PUT")
        selectedModelId = route.request().postDataJSON().modelId
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modelsPayload()) })
        return
      }
      if (url.pathname === "/api/models") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modelsPayload()) })
        return
      }
      const model = modelsPayload().models.find((candidate) => candidate.id === suffix)
      await route.fulfill({
        status: model ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(model ? { model, provider: model.type === "cloud" ? provider() : null } : { error: "not found" }),
      })
    })
    await page.route("**/api/providers/openai/credential", async (route) => {
      if (route.request().method() === "PUT") {
        expect(route.request().postDataJSON()).toEqual({ value: "test-key-value" })
        openAiConfigured = true
      } else if (route.request().method() === "DELETE") {
        openAiConfigured = false
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(modelsPayload()) })
    })
    const home = new HomePage(page)
    await home.goto()

    const guide = await home.openNavigationDialog("開始說明", "開始說明")
    const guideHeight = await guide.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).height),
    )
    await guide.getByRole("button", { name: "關閉", exact: true }).click()

    const settings = await home.openNavigationDialog("轉錄設定", "轉錄設定")
    const settingsHeight = await settings.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).height),
    )
    expect(settingsHeight).toBeCloseTo(guideHeight, 0)
    await expect(settings.getByRole("tab")).toHaveCount(0)
    await expect(settings.getByRole("columnheader")).toHaveText([
      "選用",
      "類型",
      "模型",
      "狀態",
      "操作",
    ])
    const tableRegion = settings.locator(".model-table-scroll-region")
    const tableScroll = tableRegion.locator('[data-slot="table-body"]')
    const tableHeader = tableRegion.locator('[data-slot="table-header"]')
    const headerTop = await tableHeader.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
    const layout = await tableRegion.locator("table.unified-model-table").evaluate((table) => ({
      headers: [...table.querySelectorAll("th")].map((header) => header.getBoundingClientRect().width),
      tableWidth: table.getBoundingClientRect().width,
      regionWidth: table.closest(".model-table-scroll-region")?.getBoundingClientRect().width ?? 0,
    }))
    expect(layout.tableWidth).toBeLessThanOrEqual(layout.regionWidth + 1)
    expect(layout.headers[2]).toBeGreaterThan(Math.max(...layout.headers.filter((_, index) => index !== 2)))
    const scroll = await tableScroll.evaluate((element) => {
      const max = element.scrollHeight - element.clientHeight
      element.scrollTop = max
      return { max, actual: element.scrollTop }
    })
    expect(scroll.max).toBeGreaterThan(0)
    expect(scroll.actual).toBeGreaterThan(0)
    await expect
      .poll(() => tableHeader.evaluate(
        (element) => element.getBoundingClientRect().top,
      ))
      .toBeCloseTo(headerTop, 0)
    await tableScroll.evaluate((element) => { element.scrollTop = 0 })

    const cloudRow = settings.getByRole("row").filter({ hasText: "OpenAI whisper-1" })
    await expect(cloudRow.getByRole("button", { name: "選用 OpenAI whisper-1" })).toBeDisabled()
    await cloudRow.getByRole("button", { name: "查看 OpenAI whisper-1 詳情" }).click()
    await expect(page).toHaveURL(/\/settings\/models\/cloud\.openai\.whisper-1$/)
    const details = page.getByRole("dialog", { name: "OpenAI whisper-1" })
    await expect(details).toContainText("每次真正上傳前仍會另外詢問你的同意")
    await details.getByLabel("OPENAI_API_KEY").fill("test-key-value")
    await details.getByRole("button", { name: "設定 API Key" }).click()
    await expect(details.getByRole("button", { name: "使用這個模型" })).toBeEnabled()
    await details.getByRole("button", { name: "使用這個模型" }).click()
    await expect(details.getByRole("button", { name: "目前選用" })).toBeDisabled()
    await details.getByRole("button", { name: "關閉", exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole("dialog", { name: "轉錄設定" })).toBeVisible()
  })
})
