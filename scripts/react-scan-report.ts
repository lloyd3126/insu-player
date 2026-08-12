import { chromium, type Page } from "@playwright/test"

const baseURL = process.env.INSU_SCAN_BASE_URL ?? "http://127.0.0.1:5173"
const runsArgument = process.argv.find((argument) => argument.startsWith("--runs="))
const runs = Math.max(1, Number(runsArgument?.split("=")[1] ?? 3))
const compact = process.argv.includes("--compact")

interface ScanSummary {
  renderCount: number
  totalTime: number
  components: Record<string, { renderCount: number; totalTime: number }>
}

interface Measurement {
  renderCount: number
  totalTime: number
  topComponents: Array<{
    name: string
    renderCount: number
    totalTime: number
  }>
}

interface ScenarioResult {
  mount: Measurement
  idle: Measurement
  interaction: Measurement | null
}

interface Scenario {
  id: string
  route: string
  ready(page: Page): Promise<void>
  interact?(page: Page): Promise<void>
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

async function readProfiler(page: Page): Promise<Measurement> {
  const summary = await page.evaluate(() => window.__INSU_REACT_SCAN__?.summary())
  if (!summary) throw new Error("React Scan profiler is not available")
  return {
    renderCount: summary.renderCount,
    totalTime: summary.totalTime,
    topComponents: Object.entries(summary.components)
      .map(([name, value]) => ({ name, ...value }))
      .sort((left, right) => right.totalTime - left.totalTime)
      .slice(0, 10),
  }
}

const scenarios: Scenario[] = [
  {
    id: "home",
    route: "/",
    ready: async (page) => {
      await page.getByRole("heading", { name: "用 Agent 讓影音跨越語言" }).waitFor()
    },
  },
  {
    id: "guide",
    route: "/guide/initialize",
    ready: async (page) => {
      await page.getByRole("dialog", { name: "開始說明" }).waitFor()
    },
    interact: async (page) => {
      await page.getByRole("tab").nth(1).click()
    },
  },
  {
    id: "prompts",
    route: "/prompts",
    ready: async (page) => {
      await page.getByRole("dialog", { name: "我的提示" }).waitFor()
    },
  },
  {
    id: "transcription-settings",
    route: "/settings",
    ready: async (page) => {
      await page.getByRole("region", { name: "語音辨識模型列表" }).waitFor()
    },
    interact: async (page) => {
      const details = page.getByRole("button", { name: /查看 .* 詳情/ })
      if ((await details.count()) > 0) await details.first().click()
    },
  },
  {
    id: "supported-sites",
    route: "/supported-sites",
    ready: async (page) => {
      await page.getByRole("searchbox", { name: "搜尋支援網站" }).waitFor()
    },
    interact: async (page) => {
      await page.getByRole("searchbox", { name: "搜尋支援網站" }).fill("youtube")
    },
  },
  {
    id: "extension",
    route: "/extension/download",
    ready: async (page) => {
      await page.getByRole("dialog", { name: "Chrome 擴充功能" }).waitFor()
    },
    interact: async (page) => {
      await page.getByRole("tab").nth(1).click()
    },
  },
  {
    id: "library",
    route: "/library/grid",
    ready: async (page) => {
      await page.getByRole("dialog", { name: "影片中心" }).waitFor()
    },
    interact: async (page) => {
      await page.getByPlaceholder("搜尋標題、影音 ID 或網址").fill("insu")
      await page.waitForTimeout(300)
    },
  },
  {
    id: "add-media",
    route: "/guide/add-media",
    ready: async (page) => {
      await page.getByRole("textbox", { name: "影音網址" }).waitFor()
    },
    interact: async (page) => {
      await page
        .getByRole("textbox", { name: "影音網址" })
        .fill("https://example.com/video")
    },
  },
]

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function aggregate(measurements: Measurement[]) {
  return {
    medianRenderCount: median(measurements.map((value) => value.renderCount)),
    medianTotalTime: median(measurements.map((value) => value.totalTime)),
    ...(compact ? {} : { runs: measurements }),
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  const results = new Map<string, ScenarioResult[]>()
  for (let run = 0; run < runs; run += 1) {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        locale: "zh-TW",
        viewport: { width: 1440, height: 1000 },
      })
      await context.addInitScript(() => {
        localStorage.setItem("insu-player:usage-policy:v2", "accepted")
      })
      const page = await context.newPage()
      await page.goto(`${baseURL}${scenario.route}`, { waitUntil: "networkidle" })
      await scenario.ready(page)
      await afterPaint(page)
      const mount = await readProfiler(page)

      await clearProfiler(page)
      await page.waitForTimeout(2_200)
      await afterPaint(page)
      const idle = await readProfiler(page)

      let interaction: Measurement | null = null
      if (scenario.interact) {
        await clearProfiler(page)
        await scenario.interact(page)
        await afterPaint(page)
        interaction = await readProfiler(page)
      }
      const runsForScenario = results.get(scenario.id) ?? []
      runsForScenario.push({ mount, idle, interaction })
      results.set(scenario.id, runsForScenario)
      await context.close()
    }
  }

  const report = Object.fromEntries(
    [...results].map(([id, values]) => [
      id,
      {
        mount: aggregate(values.map((value) => value.mount)),
        idle: aggregate(values.map((value) => value.idle)),
        interaction: values[0]?.interaction
          ? aggregate(values.flatMap((value) => value.interaction ?? []))
          : null,
      },
    ]),
  )
  const violations: string[] = []
  for (const [id, values] of results) {
    if (values.some((value) => value.idle.renderCount !== 0)) {
      violations.push(`${id}: idle renders must remain zero`)
    }
    if (
      values.some((value) =>
        value.interaction?.topComponents.some(
          (component) => component.name === "HomeShell" && component.renderCount > 0,
        ),
      )
    ) {
      violations.push(`${id}: modal interaction rendered HomeShell`)
    }
    if (values.some((value) => (value.interaction?.totalTime ?? 0) > 100)) {
      violations.push(`${id}: interaction render time exceeded 100 ms`)
    }
  }
  console.log(
    JSON.stringify(
      {
        baseURL,
        measuredAt: new Date().toISOString(),
        runs,
        qualityGate: {
          passed: violations.length === 0,
          violations,
        },
        scenarios: report,
      },
      null,
      2,
    ),
  )
  if (violations.length > 0) process.exitCode = 1
} finally {
  await browser.close()
}
