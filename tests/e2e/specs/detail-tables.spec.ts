import { expect, test, type Locator, type Page } from "@playwright/test"

import { HomePage } from "../pages/home.page"

async function openMediaDetails(page: Page) {
  const home = new HomePage(page)
  await home.goto()
  const library = await home.openLibrary()
  const card = library.locator(".video-grid-card").filter({
    hasText: "雙語測試影音",
  })
  await card.hover()
  await card.getByRole("button", { name: "設定 雙語測試影音" }).click()
  return page.getByRole("dialog", { name: "雙語測試影音" })
}

async function tableVisualMetrics(frame: Locator) {
  return frame.evaluate((element) => {
    const dataTable = element.querySelector("table")
    const header = dataTable?.querySelector("th:last-child")
    const cell = dataTable?.querySelector("tbody td")
    const badge = dataTable?.querySelector('[data-slot="badge"]')
    if (!dataTable || !header || !cell || !badge) {
      throw new Error("table visual fixture is incomplete")
    }
    const frameStyle = getComputedStyle(element)
    const headerGroupStyle = getComputedStyle(header.closest("thead")!)
    const headerRowStyle = getComputedStyle(header.closest("tr")!)
    const headerStyle = getComputedStyle(header)
    const cellStyle = getComputedStyle(cell)
    const badgeStyle = getComputedStyle(badge)
    return {
      frame: {
        background: frameStyle.backgroundColor,
        borderWidth: frameStyle.borderTopWidth,
        borderColor: frameStyle.borderTopColor,
        radius: frameStyle.borderRadius,
      },
      header: {
        height: headerStyle.height,
        paddingLeft: headerStyle.paddingLeft,
        paddingRight: headerStyle.paddingRight,
        fontSize: headerStyle.fontSize,
        fontWeight: headerStyle.fontWeight,
        textAlign: headerStyle.textAlign,
        background: headerGroupStyle.backgroundColor,
        dividerWidth: headerRowStyle.borderBottomWidth,
        dividerColor: headerRowStyle.borderBottomColor,
      },
      cell: {
        paddingLeft: cellStyle.paddingLeft,
        paddingRight: cellStyle.paddingRight,
      },
      badge: {
        height: badgeStyle.height,
        radius: badgeStyle.borderRadius,
        fontSize: badgeStyle.fontSize,
        fontWeight: badgeStyle.fontWeight,
      },
    }
  })
}

async function expectLeftAlignedActions(
  table: Locator,
  actionGroupSelector: string,
) {
  const offsets = await table.evaluate((element, groupSelector) => {
    const header = [...element.querySelectorAll("th")].find(
      (candidate) => candidate.textContent?.trim() === "操作",
    )
    const group = element.querySelector(groupSelector)
    const cell = group?.closest("td")
    const firstAction = group?.firstElementChild
    if (!header || !group || !cell || !firstAction) {
      throw new Error("action column fixture is incomplete")
    }
    const headerRange = document.createRange()
    headerRange.selectNodeContents(header)
    return {
      headerTextStart: headerRange.getBoundingClientRect().left,
      headerCellStart:
        header.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(header).paddingLeft),
      actionStart: firstAction.getBoundingClientRect().left,
      actionCellStart:
        cell.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(cell).paddingLeft),
      groupJustification: getComputedStyle(group).justifyContent,
      headerAlignment: getComputedStyle(header).textAlign,
      cellAlignment: getComputedStyle(cell).textAlign,
    }
  }, actionGroupSelector)

  expect(offsets.headerAlignment).toBe("left")
  expect(offsets.cellAlignment).toBe("left")
  expect(offsets.groupJustification).toBe("flex-start")
  expect(Math.abs(offsets.headerTextStart - offsets.headerCellStart)).toBeLessThan(1)
  expect(Math.abs(offsets.actionStart - offsets.actionCellStart)).toBeLessThan(1)
}

test("detail tables share one visual system and left-align actions", async ({
  page,
}) => {
  const detail = await openMediaDetails(page)

  await detail.getByRole("tab", { name: "影音狀態" }).click()
  const historyFrame = detail.locator(".history-table-container")
  const historyTable = historyFrame.locator(".history-table")
  const historyMetrics = await tableVisualMetrics(historyFrame)

  await detail.getByRole("tab", { name: "畫質管理" }).click()
  const qualityFrame = detail.locator(".media-quality-table-frame")
  const qualityTable = qualityFrame.locator(".media-quality-table")
  const qualityMetrics = await tableVisualMetrics(qualityFrame)
  await expectLeftAlignedActions(qualityTable, ".media-quality-actions")
  const qualityAction = qualityTable.getByRole("button", {
    name: "下載",
    exact: true,
  })
  await qualityAction.focus()
  expect(
    await qualityAction.evaluate(
      (element) => getComputedStyle(element.closest("tr")!).backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)")

  await detail.getByRole("tab", { name: "字幕管理" }).click()
  const subtitleFrame = detail.locator(".subtitle-revision-table-frame")
  const subtitleTable = subtitleFrame.locator(".subtitle-revision-table")
  const subtitleMetrics = await tableVisualMetrics(subtitleFrame)
  await expectLeftAlignedActions(subtitleTable, ".subtitle-revision-actions")

  for (const metrics of [qualityMetrics, subtitleMetrics]) {
    expect(metrics.frame).toEqual(historyMetrics.frame)
    expect(metrics.header).toEqual(historyMetrics.header)
    expect(metrics.cell).toEqual(historyMetrics.cell)
    expect(metrics.badge).toEqual(historyMetrics.badge)
  }

  await page.setViewportSize({ width: 420, height: 900 })

  await detail.getByRole("tab", { name: "畫質管理" }).click()
  await qualityFrame.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await expectLeftAlignedActions(qualityTable, ".media-quality-actions")
  await expect(qualityAction).toBeVisible()

  await detail.getByRole("tab", { name: "字幕管理" }).click()
  await expectLeftAlignedActions(subtitleTable, ".subtitle-revision-actions")
  await expect(subtitleTable.locator(".subtitle-revision-actions button").first()).toBeVisible()
})
