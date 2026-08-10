import { expect, test } from "@playwright/test"

import { HomePage } from "../pages/home.page"
import {
  BUILT_IN_PROMPTS,
  CHECK_SOURCE_SUPPORT_PROMPT,
  ENVIRONMENT_PROMPT,
  buildAddVideoPrompt,
} from "../../../src/shared/prompts/insu-prompts"

test.describe("INSU Player home @smoke", () => {
  test("keeps the homepage focused on three primary destinations", async ({ page }) => {
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

    await expect(home.navigation.getByRole("button")).toHaveCount(3)
    await expect(
      home.navigation.getByRole("button", { name: "使用說明" }),
    ).toBeVisible()
    await expect(
      home.navigation.getByRole("button", { name: "功能設定" }),
    ).toBeVisible()
    await expect(
      home.navigation.getByRole("button", { name: "開始使用", exact: true }),
    ).toHaveCount(0)
    await expect(
      home.navigation.getByRole("button", { name: "介面設定" }),
    ).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })

  test("groups all guidance into three reusable tabs", async ({ page }) => {
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
    const home = new HomePage(page)
    await home.goto()

    const guide = await home.openNavigationDialog("使用說明", "使用說明")
    await expect(guide.getByRole("tab")).toHaveCount(3)
    await expect(guide.getByRole("tab", { name: "使用情境" })).toHaveCount(0)
    await expect(guide.getByText("加入一支影音", { exact: true })).toBeVisible()
    await expect(
      guide.getByText(
        "貼上影音網址並複製提示，接下來只需要用一般語言回答想要哪種字幕。",
      ),
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
    const tabStartTops = [await firstContentTop("開始使用")]

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
    await expect(guide.locator(".tutorial-step-list > li")).toHaveCount(4)
    const usageCopy = await usageCallout.boundingBox()
    const usageAction = await usageCallout
      .getByRole("button", { name: /已複製|複製加入提示/ })
      .boundingBox()
    const tutorialCard = await guide.locator(".tutorial-card").boundingBox()
    expect(usageCopy).not.toBeNull()
    expect(usageAction).not.toBeNull()
    expect(tutorialCard).not.toBeNull()
    expect(usageAction!.x).toBeGreaterThan(usageCopy!.x + usageCopy!.width / 2)
    expect(usageAction!.y).toBeLessThan(usageCopy!.y + usageCopy!.height / 3)
    expect(tutorialCard!.y).toBeGreaterThanOrEqual(
      usageCopy!.y + usageCopy!.height,
    )

    const myPromptsTab = guide.getByRole("tab", { name: "我的提示" })
    await myPromptsTab.click()
    tabStartTops.push(await firstContentTop("我的提示"))
    const guideBody = guide.locator(".app-dialog__body")
    const guideTabs = guide.locator(".app-dialog-tabs")
    const guideTabList = guide.getByRole("tablist")
    const myPromptsPanel = guide.getByRole("tabpanel", { name: "我的提示" })
    const myPrompts = myPromptsPanel.locator(".advanced-section")
    const myPromptsCallout = myPrompts.locator(":scope > .prompt-action-card")
    const myPromptsScrollRegion = myPrompts.locator(
      ":scope > .my-prompts-scroll-region",
    )
    await expect(guideBody).toHaveClass(/app-dialog__body--tabbed/)
    expect(
      await guideBody.evaluate((element) => getComputedStyle(element).overflowY),
    ).toBe("hidden")
    expect(
      await guideTabs.evaluate((element) => getComputedStyle(element).overflow),
    ).toBe("hidden")
    expect(
      await myPromptsPanel.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("hidden")
    expect(
      await myPromptsPanel.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingInlineEnd),
      ),
    ).toBe(12)
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
    const tabListTop = await guideTabList.evaluate(
      (element) => element.getBoundingClientRect().top,
    )
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
      await myPromptsPanel.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeLessThanOrEqual(1)
    expect(
      await guideTabList.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ).toBeCloseTo(tabListTop, 0)
    expect(
      await myPromptsCallout.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ).toBeCloseTo(calloutTop, 0)
    await myPromptsScrollRegion.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(
      guide.getByRole("heading", { name: BUILT_IN_PROMPTS[0].title }),
    ).toBeVisible()
    await expect(guide.getByText("READY TO COPY")).toHaveCount(0)
    await expect(guide.getByText("BUILT-IN PLAYBOOK")).toHaveCount(0)
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

    await myPromptsTab.press("ArrowRight")
    const supportedSites = guide.getByRole("tab", { name: "支援網站" })
    await expect(supportedSites).toBeFocused()
    await supportedSites.press("Enter")
    await expect(
      supportedSites,
    ).toHaveAttribute("aria-selected", "true")
    await expect(guide.getByText("CURRENT COVERAGE")).toHaveCount(0)
    await expect(
      guide.getByText("INSU Player 的來源支援由"),
    ).toHaveCount(0)
    await expect(guide.getByText("詢問 Agent 是否支援")).toBeVisible()
    await expect(guide.getByText("研究還沒支援的平台")).toHaveCount(0)
    await expect(guide.getByText("更新 yt-dlp", { exact: true })).toHaveCount(0)
    const supportedSitesPanel = guide.getByRole("tabpanel", {
      name: "支援網站",
    })
    const sourceSupportCard = supportedSitesPanel.locator(
      ".guide-tab-content > .prompt-action-card",
    )
    await expect(sourceSupportCard).toHaveCount(1)
    await expect(sourceSupportCard).toBeVisible()
    await expect
      .poll(async () => {
        const supportedTop = await firstContentTop("支援網站")
        return Math.abs(supportedTop - tabStartTops[0])
      })
      .toBeLessThan(2)
    tabStartTops.push(await firstContentTop("支援網站"))
    await expect(
      supportedSitesPanel.locator(".prompt-action-card--compact"),
    ).toHaveCount(0)
    const supportedSearch = guide.getByRole("searchbox", { name: "搜尋支援網站" })
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
    expect(
      Math.max(...tabStartTops) - Math.min(...tabStartTops),
      `tab starts: ${tabStartTops.join(", ")}`,
    ).toBeLessThan(2)
  })

  test("splits local and cloud models into feature settings tabs", async ({ page }) => {
    const environmentVariables = Array.from({ length: 36 }, (_, index) => ({
      name: index === 0 ? "OPENAI_API_KEY" : `TEST_API_KEY_${index + 1}`,
      label: index === 0 ? "OpenAI API 金鑰" : `測試 API Key ${index + 1}`,
      description: "供雲端模型使用",
      configured: false,
      source: null,
      providerInstalled: false,
    }))
    let environmentConfigured = false
    await page.route(/\/api\/environment(?:\/[^/?]+)?$/, async (route) => {
      const request = route.request()
      if (request.method() === "POST") {
        expect(request.postDataJSON()).toEqual({
          name: "OPENAI_API_KEY",
          value: "test-key-value",
        })
        environmentConfigured = true
      }
      if (request.method() === "DELETE") environmentConfigured = false
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scope: "process",
          variables: environmentVariables.map((variable) =>
            variable.name === "OPENAI_API_KEY"
              ? {
                  ...variable,
                  configured: environmentConfigured,
                  source: environmentConfigured ? "session" : null,
                }
              : variable,
          ),
        }),
      })
    })
    const localModels = Array.from({ length: 36 }, (_, index) => ({
      name: `local-${index + 1}`,
      displayName:
        index === 0 ? "OpenAI Whisper medium" : `Local model ${index + 1}`,
      sizeBytes: 512 * 1024 * 1024,
      ready: true,
    }))
    const cloudModels = Array.from({ length: 36 }, (_, index) => ({
      name: index === 0 ? "whisper-1" : `cloud-${index + 1}`,
      displayName:
        index === 0 ? "OpenAI whisper-1" : `Cloud model ${index + 1}`,
      installed: true,
      apiKeyName: "OPENAI_API_KEY",
      apiKeyConfigured: false,
    }))
    await page.route("**/api/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          local: {
            providerInstalled: true,
            packageVersion: "1.0.0",
            modelCount: localModels.length,
            totalSizeBytes: localModels.reduce(
              (total, model) => total + model.sizeBytes,
              0,
            ),
            models: localModels,
          },
          api: {
            providerInstalled: true,
            packageVersion: "1.0.0",
            keyConfigured: false,
            models: cloudModels,
          },
        }),
      }),
    )
    const home = new HomePage(page)
    await home.goto()

    const guide = await home.openNavigationDialog("使用說明", "使用說明")
    const guideHeight = await guide.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).height),
    )
    await guide.getByRole("button", { name: "關閉", exact: true }).click()

    const settings = await home.openNavigationDialog("功能設定", "功能設定")
    const settingsHeight = await settings.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).height),
    )
    expect(settingsHeight).toBeCloseTo(guideHeight, 0)
    await expect(settings.getByRole("tab")).toHaveCount(3)
    await expect(settings.getByRole("tab", { name: "模型列表" })).toHaveCount(0)
    const environmentPanel = settings.getByRole("tabpanel", { name: "環境變數" })
    const environmentContent = environmentPanel.locator(
      ".environment-settings-content",
    )
    const environmentPrompt = environmentContent.locator(
      ":scope > .prompt-action-card",
    )
    const environmentTableScroll = environmentContent.locator(
      ".environment-table-scroll-region",
    )
    await expect(
      environmentPrompt.getByRole("heading", {
        name: "請 Agent 檢查環境變數",
      }),
    ).toBeVisible()
    await expect(
      environmentPrompt.getByText(
        ENVIRONMENT_PROMPT.description,
        { exact: true },
      ),
    ).toBeVisible()
    await expect(settings.getByText("只在本次服務中使用")).toHaveCount(0)
    await expect(environmentContent.getByText("OpenAI SDK 尚未安裝")).toHaveCount(0)
    await expect(environmentTableScroll).toBeVisible()
    const environmentRow = environmentTableScroll
      .getByRole("row")
      .filter({ hasText: "OPENAI_API_KEY" })
    const environmentInput = environmentRow.getByLabel(
      "OPENAI_API_KEY 新值",
      { exact: true },
    )
    await expect(environmentInput).toBeVisible()
    expect(
      await environmentPanel.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("hidden")
    expect(
      await environmentTableScroll.evaluate(
        (element) => getComputedStyle(element).overflowY,
      ),
    ).toBe("auto")
    expect(
      await environmentTableScroll.evaluate(
        (element) => getComputedStyle(element).overflowX,
      ),
    ).toBe("hidden")
    const environmentTableContainer = environmentTableScroll.locator(
      ":scope > [data-slot='table-container']",
    )
    const environmentHorizontalOverflow = await Promise.all([
      environmentTableScroll.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
      environmentTableContainer.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ])
    expect(environmentHorizontalOverflow[0]).toBeLessThanOrEqual(1)
    expect(environmentHorizontalOverflow[1]).toBeLessThanOrEqual(1)
    expect(
      await environmentTableContainer.evaluate((element) => {
        element.scrollLeft = 100
        return element.scrollLeft
      }),
    ).toBe(0)
    const [environmentPromptTop, environmentRowHeight] = await Promise.all([
      environmentPrompt.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
      environmentTableScroll
        .locator("tbody tr")
        .first()
        .evaluate((element) => element.getBoundingClientRect().height),
    ])
    const environmentScroll = await environmentTableScroll.evaluate((element) => {
      const max = element.scrollHeight - element.clientHeight
      element.scrollTop = max
      return { max, actual: element.scrollTop }
    })
    expect(environmentScroll.max).toBeGreaterThan(0)
    expect(environmentScroll.actual).toBeGreaterThan(0)
    expect(environmentRowHeight).toBeCloseTo(56, 0)
    expect(
      await environmentPrompt.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    ).toBeCloseTo(environmentPromptTop, 0)
    await environmentTableScroll.evaluate((element) => {
      element.scrollTop = 0
    })
    await environmentInput.fill("test-key-value")
    await environmentRow.getByRole("button", { name: "套用" }).click()
    await expect(environmentRow.getByText("本次服務已設定")).toBeVisible()
    await expect(environmentInput).toHaveValue("")
    await environmentRow.getByRole("button", { name: "清除" }).click()
    await expect(environmentRow.getByText("尚未設定")).toBeVisible()

    const verifyModelPanel = async (
      tabName: "本機模型" | "雲端模型",
      promptTitle: string,
    ) => {
      await settings.getByRole("tab", { name: tabName }).click()
      const panel = settings.getByRole("tabpanel", { name: tabName })
      const content = panel.locator(".model-settings-content")
      const promptCard = content.locator(":scope > .prompt-action-card")
      const tableScroll = content.locator(".model-table-scroll-region")
      const firstRow = tableScroll.locator("tbody tr").first()
      await expect(promptCard).toHaveCount(1)
      await expect(
        promptCard.getByRole("heading", { name: promptTitle }),
      ).toBeVisible()
      await expect(tableScroll).toBeVisible()
      expect(
        await panel.evaluate((element) => getComputedStyle(element).overflowY),
      ).toBe("hidden")
      expect(
        await content.evaluate(
          (element) => getComputedStyle(element).overflowY,
        ),
      ).toBe("hidden")
      expect(
        await tableScroll.evaluate(
          (element) => getComputedStyle(element).overflowY,
        ),
      ).toBe("auto")
      const [promptTop, tableTop] = await Promise.all([
        promptCard.evaluate((element) => element.getBoundingClientRect().top),
        tableScroll.evaluate((element) => element.getBoundingClientRect().top),
      ])
      const rowHeight = await firstRow.evaluate(
        (element) => element.getBoundingClientRect().height,
      )
      const scroll = await tableScroll.evaluate((element) => {
        const max = element.scrollHeight - element.clientHeight
        element.scrollTop = max
        return { max, actual: element.scrollTop }
      })
      expect(scroll.max).toBeGreaterThan(0)
      expect(scroll.actual).toBeGreaterThan(0)
      expect(
        await panel.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeLessThanOrEqual(1)
      expect(
        await promptCard.evaluate(
          (element) => element.getBoundingClientRect().top,
        ),
      ).toBeCloseTo(promptTop, 0)
      expect(
        await tableScroll.evaluate(
          (element) => element.getBoundingClientRect().top,
        ),
      ).toBeCloseTo(tableTop, 0)
      await tableScroll.evaluate((element) => {
        element.scrollTop = 0
      })
      return rowHeight
    }

    const localRowHeight = await verifyModelPanel(
      "本機模型",
      "請 Agent 準備本機模型",
    )
    await expect(settings.getByText("OpenAI Whisper medium")).toBeVisible()
    await expect(settings.getByText("LOCAL MODEL", { exact: true })).toHaveCount(0)
    await expect(settings.getByText("CLOUD MODEL", { exact: true })).toHaveCount(0)

    const cloudRowHeight = await verifyModelPanel(
      "雲端模型",
      "請 Agent 檢查雲端模型",
    )
    expect(localRowHeight).toBeCloseTo(cloudRowHeight, 0)
    expect(localRowHeight).toBeCloseTo(56, 0)
    await expect(settings.getByText("CLOUD MODEL", { exact: true })).toHaveCount(0)
    await expect(settings.getByText("LOCAL MODEL", { exact: true })).toHaveCount(0)
    await expect(settings.getByText("OpenAI whisper-1")).toBeVisible()
    const apiKeySelect = settings.getByRole("combobox", {
      name: "OpenAI whisper-1 API Key",
    })
    await expect(apiKeySelect).toContainText("尚未設定")
    await apiKeySelect.click()
    await page.getByRole("option", { name: "設定 OPENAI_API_KEY" }).click()
    await expect(
      settings.getByRole("tab", { name: "環境變數" }),
    ).toHaveAttribute("aria-selected", "true")
    await expect(
      settings.getByLabel("OPENAI_API_KEY 新值", { exact: true }),
    ).toBeVisible()
  })
})
