import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { JobRepository } from "@server/repositories/job-repository"
import type { RemovalOperations } from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"
import type { MediaOperations } from "@server/services/media-service"
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

const media: MediaOperations = {
  catalog(videoId) {
    return {
      schemaVersion: 1,
      videoId,
      revision: 1,
      activeRenditionId: "720p-demo",
      availableBytes: 10_000_000,
      sourceRefreshedAt: "2026-08-08T00:00:00.000Z",
      formats: [],
      renditions: [],
      operation: null,
    }
  },
  async refresh(videoId) {
    return this.catalog(videoId)
  },
  download(videoId, height) {
    return {
      accepted: true,
      operation: {
        id: `${videoId}-${height}`,
        requestedHeight: height,
        state: "downloading",
        stage: "downloading",
        progress: 0,
        message: "正在下載",
        error: null,
        pid: 1,
        startedAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
        completedAt: null,
      },
    }
  },
  activate(videoId) {
    return this.catalog(videoId)
  },
}

function seedJob() {
  const job = path.join(workspace, "jobs", "demo-video")
  const renditionRoot = path.join(job, "source", "renditions")
  mkdirSync(renditionRoot, { recursive: true })
  mkdirSync(path.join(job, "logs"), { recursive: true })
  const mediaContents = "fake-media-for-range-tests"
  const mediaChecksum = createHash("sha256").update(mediaContents).digest("hex")
  writeFileSync(path.join(renditionRoot, "720p-demo.mp4"), mediaContents)
  mkdirSync(path.join(job, "media-work"), { recursive: true })
  writeFileSync(
    path.join(job, "media-work", "catalog.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      videoId: "demo-video",
      revision: 1,
      activeRenditionId: "720p-demo",
      availability: { discoveredAt: null, formats: [] },
      renditions: [
        {
          id: "720p-demo",
          requestedHeight: 720,
          width: 1280,
          height: 720,
          container: "mp4",
          videoCodec: "avc1",
          audioCodec: "aac",
          sizeBytes: Buffer.byteLength(mediaContents),
          checksum: mediaChecksum,
          createdAt: "2026-08-08T00:00:00.000Z",
          path: "source/renditions/720p-demo.mp4",
        },
      ],
      operation: null,
    })}\n`,
  )
  const sourceId = "demo-video-source-model-transcript-en-r1"
  const translationId = "demo-video-translation-en-zh-TW-r1"
  const sourceRoot = path.join(job, "subtitle-work", "artifacts", sourceId)
  const translationRoot = path.join(job, "subtitle-work", "artifacts", translationId)
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(translationRoot, { recursive: true })
  const english = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nComplete sentence\n"
  const chinese = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n完整句子\n"
  writeFileSync(path.join(sourceRoot, "source.vtt"), english)
  writeFileSync(path.join(translationRoot, "input.vtt"), english)
  writeFileSync(path.join(translationRoot, "output.vtt"), chinese)
  writeFileSync(path.join(translationRoot, "manifest.json"), '{"schemaVersion":5}\n')
  const digest = (contents: string) => createHash("sha256").update(contents).digest("hex")
  const artifactDigest = (
    tracks: Array<Record<string, unknown>>,
    manifestContents?: string,
  ) => {
    const hasher = createHash("sha256")
    for (const track of tracks) {
      hasher.update(String(track.languageCode), "utf8")
      hasher.update(String(track.checksum), "ascii")
    }
    if (manifestContents !== undefined) {
      hasher.update(createHash("sha256").update(manifestContents).digest())
    }
    return hasher.digest("hex")
  }
  const artifact = (
    id: string,
    kind: "source" | "translation",
    tracks: Array<Record<string, unknown>>,
    overrides: Record<string, unknown> = {},
  ) => {
    const manifestContents = kind === "source" ? undefined : '{"schemaVersion":5}\n'
    return {
      id,
      kind,
      revision: 1,
      lifecycleState: "ready",
      validationState: "valid",
      freshnessState: "current",
      sourceLanguage: "en",
      outputLanguage: null,
      sourceType: kind === "source" ? "model-transcript" : null,
      processor: { provider: "local", model: "medium" },
      timingUnitKind: "word",
      targetFrozen: false,
      manifestPath: null,
      checksum: artifactDigest(tracks, manifestContents),
      warningCount: 0,
      hardDefectCount: 0,
      dependencies: [],
      tracks,
      createdAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T01:00:00.000Z",
      ...overrides,
    }
  }
  writeFileSync(path.join(job, "logs", "workflow.log"), "downloaded\nreflowed\n")
  writeFileSync(
    path.join(job, "status.json"),
    `${JSON.stringify({
      schemaVersion: 6,
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
      subtitleArtifacts: [
        artifact(sourceId, "source", [{
          id: `${sourceId}-source_raw`, languageCode: "en", role: "source_raw", state: "ready",
          path: `subtitle-work/artifacts/${sourceId}/source.vtt`, checksum: digest(english),
        }]),
        artifact(translationId, "translation", [
          {
            id: `${translationId}-input_sentence`, languageCode: "en", role: "input_sentence", state: "ready",
            path: `subtitle-work/artifacts/${translationId}/input.vtt`, checksum: digest(english),
          },
          {
            id: `${translationId}-output_sentence`, languageCode: "zh-TW", role: "output_sentence", state: "ready",
            path: `subtitle-work/artifacts/${translationId}/output.vtt`, checksum: digest(chinese),
          },
        ], {
          outputLanguage: "zh-TW",
          processor: { provider: "agent", service: "codex" },
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
          manifestPath: `subtitle-work/artifacts/${translationId}/manifest.json`,
        }),
      ],
      activeSubtitleTracks: {},
      subtitlePipeline: {
        mode: "translate",
        stage: "content_complete",
        sourceLanguage: "en",
        outputLanguage: "zh-TW",
        timingProcessor: { provider: "local", model: "medium" },
        contentProcessor: { provider: "agent", service: "codex" },
        manualReferenceArtifactIds: [],
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
    media,
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
      buildId: "insu-player-status-6-content-5",
      statusSchemaVersion: 6,
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
    const artifactCount = sqlite
      .query("select count(*) as count from subtitle_artifacts")
      .get() as { count: number }
    expect(artifactCount.count).toBe(2)
    const activeTrackCount = sqlite
      .query("select count(*) as count from active_subtitle_tracks")
      .get() as { count: number }
    expect(activeTrackCount.count).toBe(2)
  })

  test("returns the subtitle catalog, artifact comparison, and active bilingual rows", async () => {
    const catalogResponse = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/subtitles",
    )
    expect(catalogResponse.status).toBe(200)
    const catalog = (await catalogResponse.json()) as {
      artifacts: Array<{ id: string; kind: string; tracks: unknown[] }>
      activeTracks: Array<{ languageCode: string; artifactKind: string }>
    }
    expect(catalog.artifacts.map(({ kind }) => kind)).toEqual([
      "source",
      "translation",
    ])
    expect(catalog.activeTracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          languageCode: "en",
          artifactKind: "source",
        }),
        expect.objectContaining({
          languageCode: "zh-TW",
          artifactKind: "translation",
        }),
      ]),
    )

    const artifact = catalog.artifacts.find(
      ({ kind }) => kind === "translation",
    )
    expect(artifact).toBeDefined()
    const artifactCaptions = await app.request(
      `http://127.0.0.1:4178/api/jobs/demo-video/subtitles/artifacts/${artifact?.id}/captions`,
    )
    expect(artifactCaptions.status).toBe(200)
    expect(await artifactCaptions.json()).toMatchObject({
      artifact: { kind: "translation" },
      baselineTrackId: "demo-video-translation-en-zh-TW-r1-input_sentence",
      rows: [
        {
          cues: {
            "demo-video-translation-en-zh-TW-r1-input_sentence": "Complete sentence",
            "demo-video-translation-en-zh-TW-r1-output_sentence": "完整句子",
          },
        },
      ],
    })

    const captions = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/captions",
    )
    const comparison = (await captions.json()) as {
      baselineTrackId: string
      rows: Array<{ cues: Record<string, string> }>
    }
    expect(comparison.baselineTrackId).toBe(
      "demo-video-source-model-transcript-en-r1-source_raw",
    )
    expect(comparison.rows[0].cues).toEqual({
      "demo-video-source-model-transcript-en-r1-source_raw": "Complete sentence",
      "demo-video-translation-en-zh-TW-r1-output_sentence": "完整句子",
    })

    const forbiddenActivation = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/subtitles/active",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://untrusted.example",
        },
        body: JSON.stringify({
          languageCode: "zh-TW",
          trackId: "demo-video-translation-en-zh-TW-r1-output_sentence",
        }),
      },
    )
    expect(forbiddenActivation.status).toBe(403)

    const activation = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/subtitles/active",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({
          languageCode: "zh-TW",
          trackId: "demo-video-translation-en-zh-TW-r1-output_sentence",
        }),
      },
    )
    expect(activation.status).toBe(200)
    expect(await activation.json()).toMatchObject({
      activeTracks: [
        expect.anything(),
        expect.objectContaining({
          languageCode: "zh-TW",
          reason: "explicit",
        }),
      ],
    })
    expect(
      JSON.parse(
        readFileSync(path.join(workspace, "jobs/demo-video/status.json"), "utf8"),
      ).activeSubtitleTracks,
    ).toEqual({
      "zh-TW": "demo-video-translation-en-zh-TW-r1-output_sentence",
    })

    const media = await app.request(
      "http://127.0.0.1:4178/media/demo-video/video",
      { headers: { Range: "bytes=0-3" } },
    )
    expect(media.status).toBe(206)
    expect(media.headers.get("content-range")).toBe("bytes 0-3/26")
    expect(await media.text()).toBe("fake")
  })

  test("serves media quality metadata and protects every media mutation by origin", async () => {
    const catalog = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/media",
    )
    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toMatchObject({
      schemaVersion: 1,
      videoId: "demo-video",
      activeRenditionId: "720p-demo",
    })

    for (const [method, route, body] of [
      ["POST", "/api/jobs/demo-video/media/refresh", undefined],
      ["POST", "/api/jobs/demo-video/media/renditions", { height: 1080 }],
      ["PUT", "/api/jobs/demo-video/media/active", { renditionId: "720p-demo" }],
    ] as const) {
      const forbidden = await app.request(`http://127.0.0.1:4178${route}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      expect(forbidden.status).toBe(403)
    }

    const accepted = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/media/renditions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({ height: 1080 }),
      },
    )
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toMatchObject({
      accepted: true,
      operation: { requestedHeight: 1080, state: "downloading" },
    })
  })

  test("serves language-code player tracks and persists the selected language", async () => {
    const selected = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/playback",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captionLanguage: "en" }),
      },
    )
    expect(selected.status).toBe(200)
    expect(await selected.json()).toMatchObject({ captionLanguage: "en" })

    const player = await app.request(
      "http://127.0.0.1:4178/watch/demo-video/config.js",
    )
    expect(player.status).toBe(200)
    const source = await player.text()
    const config = JSON.parse(
      source.replace(/^window\.INSU_PLAYER_CONFIG = /, "").replace(/;\s*$/, ""),
    ) as {
      defaultLanguage: string
      captions: Array<{
        code: string
        label: string
        artifactKind: string
        src: string
      }>
    }
    expect(config.defaultLanguage).toBe("en")
    expect(config.captions.map(({ code, label }) => [code, label])).toEqual([
      ["en", "en"],
      ["zh-TW", "zh-TW"],
    ])
    expect(config.captions.map(({ artifactKind }) => artifactKind)).toEqual([
      "source",
      "translation",
    ])
    expect(config.captions.every(({ src }) => src.includes("?revision="))).toBe(true)

    const stored = sqlite
      .query("select caption_language from playback_states where video_id = ?")
      .get("demo-video")
    expect(stored).toEqual({ caption_language: "en" })
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

    const subtitleTarget = {
      kind: "subtitle-artifact",
      videoId: "demo-video",
      artifactId: "demo-video-translation-en-zh-TW-r1",
    } as const
    const subtitlePreview = await app.request(
      "http://127.0.0.1:4178/api/removals/preview",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({ target: subtitleTarget }),
      },
    )
    expect(subtitlePreview.status).toBe(200)
    expect(previewedTarget).toEqual(subtitleTarget)
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
