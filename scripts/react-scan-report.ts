import { chromium, type Page } from "@playwright/test"

const baseURL = process.env.INSU_SCAN_BASE_URL ?? "http://127.0.0.1:5173"
const runsArgument = process.argv.find((argument) => argument.startsWith("--runs="))
const runs = Math.max(1, Number(runsArgument?.split("=")[1] ?? 3))

interface ScanSummary {
  renderCount: number
  totalTime: number
  components: Record<string, { renderCount: number; totalTime: number }>
}

interface InteractionResult extends ScanSummary {
  mountedItems: number
  totalItems: number
  topComponents: Array<{
    name: string
    renderCount: number
    totalTime: number
  }>
}

async function afterPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

async function clearProfiler(page: Page) {
  await page.waitForFunction(() => Boolean(window.__INSU_REACT_SCAN__))
  await page.evaluate(() => window.__INSU_REACT_SCAN__?.clear())
}

async function readProfiler(page: Page) {
  const summary = await page.evaluate(() => window.__INSU_REACT_SCAN__?.summary())
  if (!summary) throw new Error("React Scan profiler is not available")
  const topComponents = Object.entries(summary.components)
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.totalTime - left.totalTime)
    .slice(0, 8)
  return { ...summary, topComponents }
}

async function measureCaption(page: Page, videoId: string) {
  await page.goto(`${baseURL}/jobs/${encodeURIComponent(videoId)}/about`)
  const detail = page.getByRole("dialog")
  await detail.getByRole("tab", { name: "關於" }).waitFor()
  await clearProfiler(page)
  await detail.getByRole("tab", { name: "字幕" }).click()
  const viewport = detail.locator(".caption-table-frame")
  await viewport.waitFor()
  await viewport.locator("tbody tr").first().waitFor()
  await afterPaint(page)
  const counts = await viewport.evaluate((element) => ({
    mountedItems: element.querySelectorAll("tbody tr").length,
    totalItems: Number(element.getAttribute("data-total-rows") ?? 0),
  }))
  return { ...(await readProfiler(page)), ...counts } satisfies InteractionResult
}

async function measureSupportedSites(page: Page) {
  await page.goto(`${baseURL}/guide/my-prompts`)
  const guide = page.getByRole("dialog", { name: "使用說明" })
  await guide.getByRole("tab", { name: "我的提示" }).waitFor()
  await clearProfiler(page)
  await guide.getByRole("tab", { name: "支援網站" }).click()
  const viewport = guide.locator(".source-list")
  await viewport.waitFor()
  await viewport.getByRole("listitem").first().waitFor()
  await afterPaint(page)
  const counts = await viewport.evaluate((element) => ({
    mountedItems: element.querySelectorAll("li").length,
    totalItems: Number(element.getAttribute("data-total-items") ?? 0),
  }))
  return { ...(await readProfiler(page)), ...counts } satisfies InteractionResult
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function aggregate(results: InteractionResult[]) {
  return {
    medianRenderCount: median(results.map((result) => result.renderCount)),
    medianTotalTime: median(results.map((result) => result.totalTime)),
    maxMountedItems: Math.max(...results.map((result) => result.mountedItems)),
    totalItems: results[0]?.totalItems ?? 0,
    runs: results.map(({ components: _components, ...result }) => result),
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  const api = await fetch(`${baseURL}/api/jobs`)
  if (!api.ok) throw new Error(`Unable to read jobs: HTTP ${api.status}`)
  const jobs = (await api.json()) as { jobs: Array<{ videoId: string }> }
  const videoId = jobs.jobs[0]?.videoId
  if (!videoId) throw new Error("React Scan report requires at least one job")

  const captionResults: InteractionResult[] = []
  const supportedSiteResults: InteractionResult[] = []
  for (let index = 0; index < runs; index += 1) {
    const context = await browser.newContext({
      locale: "zh-TW",
      viewport: { width: 1440, height: 1000 },
    })
    await context.addInitScript(() => {
      localStorage.setItem("insu-player:usage-policy:v2", "accepted")
    })
    const page = await context.newPage()
    captionResults.push(await measureCaption(page, videoId))
    supportedSiteResults.push(await measureSupportedSites(page))
    await context.close()
  }

  console.log(
    JSON.stringify(
      {
        baseURL,
        videoId,
        measuredAt: new Date().toISOString(),
        captions: aggregate(captionResults),
        supportedSites: aggregate(supportedSiteResults),
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
