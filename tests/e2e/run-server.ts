import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { JobRepository } from "@server/repositories/job-repository"
import { ResourceService } from "@server/services/resource-service"

const root = path.resolve(import.meta.dir, "../..")
const workspace = mkdtempSync(path.join(tmpdir(), "insu-player-e2e-"))
const job = path.join(workspace, "jobs", "demo-video")
const port = Number(process.env.INSU_E2E_PORT ?? 42871)

mkdirSync(path.join(job, "source"), { recursive: true })
mkdirSync(path.join(job, "captions"), { recursive: true })
mkdirSync(path.join(job, "logs"), { recursive: true })
writeFileSync(path.join(job, "source", "video.mp4"), "fake media payload")
writeFileSync(
  path.join(job, "captions", "en.vtt"),
  "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nFor the last month I have been experimenting with vibe coding and collecting the practices that produce measurably better results\n\n00:00:03.000 --> 00:00:06.000\nThe second English sentence\n",
)
writeFileSync(
  path.join(job, "captions", "zh-TW.vtt"),
  "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n過去一個月我一直在嘗試 Vibe Coding 並整理能帶來明顯更好成果的實作方式\n\n00:00:03.000 --> 00:00:06.000\n第二個繁體中文句子\n",
)
writeFileSync(
  path.join(job, "logs", "workflow.log"),
  "download complete\ntranscription complete\nsubtitle reflow complete\n",
)
writeFileSync(
  path.join(job, "status.json"),
  `${JSON.stringify({
    videoId: "demo-video",
    title: "雙語測試影音",
    sourceUrl: "https://example.test/demo",
    state: "ready",
    stage: "complete",
    progress: 1,
    message: "字幕已完成",
    durationSeconds: 125.9,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T02:30:00.000Z",
    completedAt: "2026-08-08T02:30:00.000Z",
    assets: {
      video: { path: "source/video.mp4", bytes: 18 },
      captions: { path: "captions/zh-TW.vtt" },
    },
    subtitleTracks: {
      en: {
        state: "ready",
        source: "model-reflow",
        label: "English",
        path: "captions/en.vtt",
      },
      "zh-TW": {
        state: "ready",
        source: "model-reflow",
        label: "繁體中文",
        path: "captions/zh-TW.vtt",
      },
    },
    subtitleWorkflow: {
      stage: "subtitle_reflow",
      source: "model",
      provider: "local",
      model: "medium",
      sourceLanguage: "en",
      targetLanguage: "zh-TW",
      updatedAt: "2026-08-08T02:30:00.000Z",
    },
    transcription: { provider: "local", model: "medium" },
    history: [
      {
        at: "2026-08-08T00:00:00.000Z",
        state: "downloading",
        stage: "download",
        message: "影音處理中",
      },
      {
        at: "2026-08-08T02:30:00.000Z",
        state: "ready",
        stage: "complete",
        message: "字幕已完成",
      },
    ],
  })}\n`,
)

const opened = openAppDatabase(
  path.join(workspace, "app.db"),
  path.join(
    root,
    "plugins/insu-player/skills/watch-video/assets/server/drizzle",
  ),
)
const app = createApplication({
  jobs: new JobRepository(workspace, opened.db),
  resources: new ResourceService(workspace),
  libraryAppRoot: path.join(
    root,
    "plugins/insu-player/skills/watch-video/assets/library/app",
  ),
  playerRoot: path.join(
    root,
    "plugins/insu-player/skills/watch-video/assets/player",
  ),
})
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
  development: false,
})

let stopped = false
function stop() {
  if (stopped) return
  stopped = true
  server.stop(true)
  opened.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stop()
    process.exit(0)
  })
}
process.on("exit", stop)

console.log(`INSU Player E2E server: http://127.0.0.1:${server.port}/`)
