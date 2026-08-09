import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { JobRepository } from "@server/repositories/job-repository"
import type { RemovalOperations } from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"
import type { RemovalTarget } from "@shared/contracts/removal"

const repositoryRoot = path.resolve(import.meta.dir, "../..")
const migrations = path.join(
  repositoryRoot,
  "plugins/insu-player/skills/watch-video/assets/server/drizzle",
)

let workspace = ""
let sqlite: ReturnType<typeof openAppDatabase>["sqlite"]
let app: ReturnType<typeof createApplication>
let previewedTarget: RemovalTarget | null = null
let executedRemoval: { target: RemovalTarget; planDigest: string } | null = null

const removalDigest = "a".repeat(64)
const removals: RemovalOperations = {
  async preview(target) {
    previewedTarget = target
    return {
      schemaVersion: 1,
      target,
      planDigest: removalDigest,
      blocked: [],
      warnings: [],
    }
  },
  async execute(target, planDigest) {
    executedRemoval = { target, planDigest }
    return {
      schemaVersion: 1,
      target,
      planDigest,
      removed: true,
    }
  },
}

function seedJob() {
  const job = path.join(workspace, "jobs", "demo-video")
  mkdirSync(path.join(job, "source"), { recursive: true })
  mkdirSync(path.join(job, "captions"), { recursive: true })
  mkdirSync(path.join(job, "logs"), { recursive: true })
  writeFileSync(path.join(job, "source", "video.mp4"), "fake-media-for-range-tests")
  writeFileSync(
    path.join(job, "captions", "en.vtt"),
    "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nComplete sentence\n",
  )
  writeFileSync(
    path.join(job, "captions", "zh-TW.vtt"),
    "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n完整句子\n",
  )
  writeFileSync(path.join(job, "logs", "workflow.log"), "downloaded\nreflowed\n")
  writeFileSync(
    path.join(job, "status.json"),
    `${JSON.stringify({
      videoId: "demo-video",
      title: "雙語測試影音",
      sourceUrl: "https://example.test/video",
      state: "ready",
      stage: "complete",
      progress: 1,
      message: "字幕已完成",
      durationSeconds: 125.9,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z",
      completedAt: "2026-08-08T01:00:00.000Z",
      subtitleTracks: {
        en: { state: "ready", source: "model-reflow", path: "captions/en.vtt" },
        "zh-TW": { state: "ready", source: "model-reflow", path: "captions/zh-TW.vtt" },
      },
      subtitleWorkflow: {
        stage: "subtitle_reflow",
        source: "model",
        provider: "local",
        model: "medium",
        sourceLanguage: "en",
        targetLanguage: "zh-TW",
      },
      history: [
        { at: "2026-08-08T00:00:00.000Z", state: "downloading", message: "開始" },
        { at: "2026-08-08T01:00:00.000Z", state: "ready", message: "完成" },
      ],
    })}\n`,
  )
}

beforeEach(() => {
  previewedTarget = null
  executedRemoval = null
  workspace = mkdtempSync(path.join(tmpdir(), "insu-player-api-test-"))
  seedJob()
  const opened = openAppDatabase(path.join(workspace, "app.db"), migrations)
  sqlite = opened.sqlite
  const jobs = new JobRepository(workspace, opened.db)
  app = createApplication({
    jobs,
    removals,
    resources: new ResourceService(workspace),
    libraryAppRoot: path.join(
      repositoryRoot,
      "plugins/insu-player/skills/watch-video/assets/library/app",
    ),
    playerRoot: path.join(
      repositoryRoot,
      "plugins/insu-player/skills/watch-video/assets/player",
    ),
  })
})

afterEach(() => {
  sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe("Hono application", () => {
  test("serves the React homepage and health contract", async () => {
    const home = await app.request("http://127.0.0.1:4178/")
    expect(home.status).toBe(200)
    const markup = await home.text()
    expect(markup).toContain('<div id="root"></div>')
    expect(home.headers.get("content-security-policy")).toContain("frame-src 'self'")

    const assetPath = markup.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1]
    expect(assetPath).toBeDefined()
    const asset = await app.request(`http://127.0.0.1:4178${assetPath}`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get("cache-control")).toContain("immutable")
    expect(
      (await app.request("http://127.0.0.1:4178/assets/library.js")).status,
    ).toBe(404)

    for (const route of [
      "/guide/my-prompts",
      "/settings/cloud-models",
      "/library/list",
      "/jobs/demo-video/activity",
      "/player/demo-video?caption=zh-TW",
      "/policy",
    ]) {
      const fallback = await app.request(`http://127.0.0.1:4178${route}`)
      expect(fallback.status).toBe(200)
      expect(await fallback.text()).toContain('<div id="root"></div>')
    }

    const health = await app.request("http://127.0.0.1:4178/api/health")
    expect(await health.json()).toEqual({
      ok: true,
      status: "ok",
      runtime: "bun",
      framework: "hono",
      database: "sqlite",
      port: 4178,
    })
    expect(statSync(path.join(workspace, "app.db")).mode & 0o077).toBe(0)

    const detail = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video",
    )
    expect(detail.status).toBe(200)
    expect((await detail.json()).history).toMatchObject([
      { sequence: 0, message: "開始" },
      { sequence: 1, message: "完成" },
    ])
  })

  test("projects status.json into SQLite while preserving the filesystem fact source", async () => {
    const response = await app.request("http://127.0.0.1:4178/api/jobs")
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { jobs: Array<Record<string, unknown>> }
    expect(payload.jobs).toHaveLength(1)
    expect(payload.jobs[0]).toMatchObject({
      videoId: "demo-video",
      title: "雙語測試影音",
      captionCodes: ["en", "zh-TW"],
      watchable: true,
      durationSeconds: 125.9,
    })

    const projected = sqlite
      .query("select video_id, effective_state from jobs")
      .get() as { video_id: string; effective_state: string }
    expect(projected).toEqual({ video_id: "demo-video", effective_state: "ready" })
    const trackCount = sqlite.query("select count(*) as count from subtitle_tracks").get() as { count: number }
    expect(trackCount.count).toBe(2)
  })

  test("returns normalized bilingual rows and byte ranges", async () => {
    const captions = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/captions",
    )
    const comparison = (await captions.json()) as {
      baselineLanguage: string
      rows: Array<{ cues: Record<string, string> }>
    }
    expect(comparison.baselineLanguage).toBe("en")
    expect(comparison.rows[0].cues).toEqual({
      en: "Complete sentence",
      "zh-TW": "完整句子",
    })

    const media = await app.request(
      "http://127.0.0.1:4178/media/demo-video/video",
      { headers: { Range: "bytes=0-3" } },
    )
    expect(media.status).toBe(206)
    expect(media.headers.get("content-range")).toBe("bytes 0-3/26")
    expect(await media.text()).toBe("fake")
  })

  test("persists playback in both the job folder and app database", async () => {
    const response = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/playback",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: 12.25, duration: 120 }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ time: 12.25, duration: 120 })
    const stored = sqlite.query("select time, duration from playback_states").get()
    expect(stored).toEqual({ time: 12.25, duration: 120 })
  })

  test("previews and executes a same-origin direct removal", async () => {
    const target = { kind: "video", videoId: "demo-video" } as const
    const forbidden = await app.request(
      "http://127.0.0.1:4178/api/removals/preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      },
    )
    expect(forbidden.status).toBe(403)

    const preview = await app.request(
      "http://127.0.0.1:4178/api/removals/preview",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({ target }),
      },
    )
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({
      target,
      planDigest: removalDigest,
      blocked: [],
    })
    expect(previewedTarget).toEqual(target)

    const execution = await app.request(
      "http://127.0.0.1:4178/api/removals/execute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({ target, planDigest: removalDigest }),
      },
    )
    expect(execution.status).toBe(200)
    expect(await execution.json()).toMatchObject({ target, removed: true })
    expect(executedRemoval).toEqual({ target, planDigest: removalDigest })
  })

  test("rejects cross-origin environment mutation and path-shaped video IDs", async () => {
    const environment = await app.request(
      "http://127.0.0.1:4178/api/environment",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.example",
        },
        body: JSON.stringify({ name: "OPENAI_API_KEY", value: "not-a-real-key" }),
      },
    )
    expect(environment.status).toBe(403)

    const traversal = await app.request(
      "http://127.0.0.1:4178/api/jobs/%2e%2e%2fstatus",
    )
    expect(traversal.status).toBe(404)
  })
})
