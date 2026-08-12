import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { JobRepository } from "@server/repositories/job-repository"
import { DownloadQueueService } from "@server/services/download-queue-service"
import { LibraryService } from "@server/services/library-service"
import { LocalMediaImportService } from "@server/services/local-media-import-service"
import { ExtensionPairingService } from "@server/services/extension-pairing-service"
import { ExtensionPackageService } from "@server/services/extension-package-service"
import { MediaSessionService } from "@server/services/media-session-service"
import { TranscriptionModelCatalogService } from "@server/services/transcription-model-catalog-service"
import { NoteService } from "@server/services/note-service"
import type { RemovalOperations } from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"
import { RuntimeService } from "@server/services/runtime-service"
import { SummaryService } from "@server/services/summary-service"
import { SubtitleStyleService } from "@server/services/subtitle-style-service"
import type { MediaOperations } from "@server/services/media-service"
import type { RemovalTarget } from "@shared/contracts/removal"
import { EXTENSION_CONNECTION_PROTOCOL_VERSION } from "@shared/contracts/browser-extension"
import { DEFAULT_SUBTITLE_STYLES } from "@shared/contracts/subtitle-style"

const repositoryRoot = path.resolve(import.meta.dir, "../..")
const schema = path.join(
  repositoryRoot,
  "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql",
)

let workspace = ""
let sqlite: ReturnType<typeof openAppDatabase>["sqlite"]
let database: ReturnType<typeof openAppDatabase>["db"]
let jobRepository: JobRepository
let mediaSessionService: MediaSessionService
let downloadQueueService: DownloadQueueService
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
          formatId: "720+audio",
          selection: null,
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
  const translationManifestContents = `${JSON.stringify({
    schemaVersion: 5,
    mode: "translate",
    sourceFormat: "model-timed-units",
    sourceLanguage: "en",
    outputLanguage: "zh-TW",
    sourceTranscript: "transcript.json",
    timingSourceArtifactId: sourceId,
    sourceContentArtifactId: sourceId,
    sourceContentKind: "model-transcript",
    sourceContentManifest: null,
    sourceContentChecksum: null,
    referenceArtifactIds: [],
    timingProcessor: { provider: "local", service: "openai-whisper", model: "medium" },
    contentProcessor: { provider: "agent", service: "codex" },
    sentenceReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-08T01:00:00.000Z" },
    outputProfile: {},
    rules: {},
    segments: [],
  })}\n`
  writeFileSync(
    path.join(translationRoot, "manifest.json"),
    translationManifestContents,
  )
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
    const manifestContents =
      kind === "source" ? undefined : translationManifestContents
    const currentTracks = tracks.map((track) => ({
      updatedAt: "2026-08-08T01:00:00.000Z",
      ...track,
    }))
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
      processor: {
        provider: "local",
        service: "openai-whisper",
        model: "medium",
      },
      timingUnitKind: "word",
      targetFrozen: false,
      manifestPath: null,
      checksum: artifactDigest(currentTracks, manifestContents),
      warningCount: 0,
      hardDefectCount: 0,
      dependencies: [],
      tracks: currentTracks,
      createdAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T01:00:00.000Z",
      ...overrides,
    }
  }
  writeFileSync(path.join(job, "logs", "workflow.log"), "downloaded\nreflowed\n")
  return {
      schemaVersion: 3,
      videoId: "demo-video",
      title: "雙語測試影音",
      sourceUrl: "https://example.test/video",
      sourceKind: "page",
      state: "ready",
      stage: "complete",
      progress: 1,
      message: "字幕已完成",
      durationSeconds: 125.9,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z",
      completedAt: "2026-08-08T01:00:00.000Z",
      lastError: null,
      process: null,
      assets: {
        mediaCatalog: {
          path: "media-work/catalog.json",
          bytes: 1,
          updatedAt: "2026-08-08T01:00:00.000Z",
        },
      },
      transcription: {
        provider: "local",
        service: "openai-whisper",
        model: "medium",
        languageTag: "en",
        engineLanguage: "en",
        updatedAt: "2026-08-08T01:00:00.000Z",
      },
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
        timingProcessor: {
          provider: "local",
          service: "openai-whisper",
          model: "medium",
        },
        contentProcessor: { provider: "agent", service: "codex" },
        manualReferenceArtifactIds: [],
        updatedAt: "2026-08-08T01:00:00.000Z",
      },
      history: [
        { at: "2026-08-08T00:00:00.000Z", state: "downloading", stage: "download", message: "開始" },
        { at: "2026-08-08T01:00:00.000Z", state: "ready", stage: "complete", message: "完成" },
      ],
  }
}

function mutateStatus(
  mutation: (status: Record<string, unknown>) => void,
) {
  const row = sqlite
    .query("SELECT record_json FROM media_items WHERE video_id = ?")
    .get("demo-video") as { record_json: string }
  const status = JSON.parse(row.record_json) as Record<string, unknown>
  mutation(status)
  sqlite
    .query(
      "UPDATE media_items SET record_json = ?, record_revision = record_revision + 1 WHERE video_id = ?",
    )
    .run(JSON.stringify(status), "demo-video")
}

function seedDownloadItem({
  itemId,
  operationId,
  sourceUrl,
  state = "failed",
  videoId = null,
  sessionId = null,
  resumable = true,
}: {
  itemId: string
  operationId: string
  sourceUrl: string
  state?: "failed" | "cancelled"
  videoId?: string | null
  sessionId?: string | null
  resumable?: boolean
}) {
  const timestamp = "2026-08-11T01:00:00.000Z"
  sqlite
    .query(
      "INSERT INTO operations (id, video_id, parent_operation_id, kind, state, stage, progress, message, inputs_json, outputs_json, consent_json, resumable, attempt, pid, error_code, error_message, created_at, started_at, updated_at, completed_at) VALUES (?, ?, NULL, 'media-download', ?, 'media-download', 0, '影音下載失敗', '{}', '{}', '{\"rightsConfirmed\":true}', ?, 1, NULL, 'download-failed', 'download process failed', ?, ?, ?, ?)",
    )
    .run(
      operationId,
      videoId,
      state,
      resumable ? 1 : 0,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    )
  sqlite
    .query(
      "INSERT INTO operation_events (operation_id, sequence, type, state, stage, progress, message, data_json, created_at) VALUES (?, 1, 'created', ?, 'media-download', 0, '影音下載失敗', '{}', ?)",
    )
    .run(operationId, state, timestamp)
  sqlite
    .query(
      "INSERT INTO download_queue_items (id, source_kind, page_url, source_url, source_key, session_id, operation_id, video_id, rights_confirmed, low_quality_approved, authentication, authentication_consent_at, created_at, completed_at) VALUES (?, 'page', ?, ?, ?, ?, ?, ?, 1, 0, ?, NULL, ?, ?)",
    )
    .run(
      itemId,
      sourceUrl,
      sourceUrl,
      `page:${sourceUrl}`,
      sessionId,
      operationId,
      videoId,
      sessionId ? "browser-session" : "none",
      timestamp,
      timestamp,
    )
}

beforeEach(() => {
  previewedTarget = null
  executedRemoval = null
  workspace = mkdtempSync(path.join(tmpdir(), "insu-player-api-test-"))
  const status = seedJob()
  const opened = openAppDatabase(path.join(workspace, "app.db"), schema)
  sqlite = opened.sqlite
  database = opened.db
  sqlite
    .query(
      "INSERT INTO media_items (video_id, title, source_url, state, effective_state, stage, progress, message, created_at, updated_at, completed_at, last_error, watchable, size_bytes, thumbnail_url, watch_url, has_log, duration_seconds, record_json, record_revision, projected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, ?, 1, ?)",
    )
    .run(
      status.videoId,
      status.title,
      status.sourceUrl,
      status.state,
      status.state,
      status.stage,
      status.progress,
      status.message,
      status.createdAt,
      status.updatedAt,
      status.completedAt,
      status.lastError,
      status.durationSeconds,
      JSON.stringify(status),
      status.updatedAt,
    )
  const jobs = new JobRepository(workspace, opened.db)
  const mediaSessions = new MediaSessionService(workspace)
  jobRepository = jobs
  mediaSessionService = mediaSessions
  downloadQueueService = new DownloadQueueService(
    workspace,
    opened.db,
    jobs,
    path.join(
      repositoryRoot,
      "plugins/insu-player/skills/watch-video/scripts/download-video.sh",
    ),
    mediaSessions,
  )
  const fakeFfmpeg = path.join(workspace, "fake-ffmpeg")
  writeFileSync(
    fakeFfmpeg,
    "#!/bin/sh\nprintf 'Duration: 00:00:03.250, start: 0.000000, bitrate: 100 kb/s\\nStream #0:0: Video: h264, yuv420p, 640x360\\nStream #0:1: Audio: aac, 44100 Hz, stereo\\n' >&2\nexit 1\n",
    { mode: 0o700 },
  )
  chmodSync(fakeFfmpeg, 0o700)
  const imports = new LocalMediaImportService(
    workspace,
    opened.db,
    jobs,
    fakeFfmpeg,
  )
  app = createApplication({
    jobs,
    downloads: downloadQueueService,
    imports,
    library: new LibraryService(downloadQueueService, imports),
    extensionPairing: new ExtensionPairingService(
      opened.db,
    ),
    extensionPackage: new ExtensionPackageService(
      path.join(repositoryRoot, "plugins/insu-player/chrome-extension"),
    ),
    mediaSessions,
    models: new TranscriptionModelCatalogService(workspace, opened.db),
    summaries: new SummaryService(jobs, opened.db),
    subtitleStyles: new SubtitleStyleService(opened.db),
    notes: new NoteService(opened.db),
    media,
    removals,
    resources: new ResourceService(workspace),
    runtime: new RuntimeService(workspace, opened.db),
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
      "/guide/add-media",
      "/prompts",
      "/supported-sites",
      "/extension/download",
      "/extension/connect",
      "/extension/usage",
      "/settings",
      "/settings/models/cloud.groq.whisper-large-v3",
      "/library/list",
      "/jobs/demo-video/activity",
      "/player/demo-video?caption=zh-TW",
      "/policy",
      "/extension/library",
    ]) {
      const fallback = await app.request(`http://127.0.0.1:4178${route}`)
      expect(fallback.status).toBe(200)
      expect(await fallback.text()).toContain('<div id="root"></div>')
    }

    for (const removedSettingsRoute of [
      "/settings/transcription",
      "/settings/local-models",
      "/settings/cloud-models",
      "/settings/environment",
    ]) {
      expect(
        (await app.request(`http://127.0.0.1:4178${removedSettingsRoute}`)).status,
      ).toBe(404)
    }

    const health = await app.request("http://127.0.0.1:4178/api/health")
    expect(await health.json()).toEqual({
      ok: true,
      status: "ok",
      runtime: "bun",
      framework: "hono",
      buildId: "insu-player-download-task-controls-v1",
      dataSchemaVersion: 9,
      extensionProtocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
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

  test("uses SQLite as the sole media and workflow fact source", async () => {
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
      .query("select video_id, effective_state from media_items")
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

  test("downloads the exact extension package and pairs once without storing raw secrets", async () => {
    const origin = "http://127.0.0.1:4178"
    const extensionOrigin = `chrome-extension://${"a".repeat(32)}`

    const packageResponse = await app.request(`${origin}/api/extension/package`, {
      method: "POST",
      headers: { Origin: origin },
    })
    expect(packageResponse.status).toBe(200)
    expect(packageResponse.headers.get("content-type")).toBe("application/zip")
    expect(packageResponse.headers.get("content-disposition")).toContain(
      "insu-player-extension-v0.3.0.zip",
    )
    const packageBytes = new Uint8Array(await packageResponse.arrayBuffer())
    const packageChecksum = packageResponse.headers.get("x-insu-package-sha256")
    if (!packageChecksum) throw new Error("missing extension package checksum")
    expect(
      createHash("sha256").update(packageBytes).digest("hex"),
    ).toBe(packageChecksum)
    const packageFiles = unzipSync(packageBytes)
    expect(Object.keys(packageFiles).sort()).toEqual([
      "connection-protocol.js",
      "content-bridge.js",
      "manifest.json",
      "media-discovery.js",
      "pairing-bootstrap.json",
      "popup.css",
      "popup.html",
      "popup.js",
      "service-worker.js",
    ])
    const invitation = JSON.parse(
      new TextDecoder().decode(packageFiles["pairing-bootstrap.json"]),
    ) as {
      protocolVersion: number
      invitationId: string
      ticket: string
      serverOrigin: string
    }
    expect(invitation.protocolVersion).toBe(
      EXTENSION_CONNECTION_PROTOCOL_VERSION,
    )
    expect(invitation.serverOrigin).toBe(origin)
    const storedInvitation = sqlite
      .query(
        "select ticket_hash, claimed_at, revoked_at from extension_pairing_invitations where id = ?",
      )
      .get(invitation.invitationId) as {
        ticket_hash: string
        claimed_at: string | null
        revoked_at: string | null
      }
    expect(storedInvitation.ticket_hash).not.toContain(invitation.ticket)
    expect(storedInvitation.claimed_at).toBeNull()
    expect(storedInvitation.revoked_at).toBeNull()

    const incompatibleClaim = await app.request(
      `${origin}/api/extension/pairing/claim`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
        },
        body: JSON.stringify({
          invitationId: invitation.invitationId,
          ticket: invitation.ticket,
        }),
      },
    )
    expect(incompatibleClaim.status).toBe(400)

    const claim = await app.request(`${origin}/api/extension/pairing/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
      },
      body: JSON.stringify({
        protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
        invitationId: invitation.invitationId,
        ticket: invitation.ticket,
      }),
    })
    expect(claim.status).toBe(201)
    expect(claim.headers.get("access-control-allow-origin")).toBe(extensionOrigin)
    const claimed = (await claim.json()) as { connectionToken: string }
    expect(claimed.connectionToken).not.toBe(invitation.ticket)

    const reused = await app.request(`${origin}/api/extension/pairing/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
      },
      body: JSON.stringify({
        protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
        invitationId: invitation.invitationId,
        ticket: invitation.ticket,
      }),
    })
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({ code: "bootstrap-consumed" })

    const pairingStatus = await app.request(`${origin}/api/extension/pairing`)
    expect(pairingStatus.status).toBe(200)
    expect(await pairingStatus.json()).toMatchObject({
      protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      paired: true,
      extensionOrigin,
      serverOrigin: origin,
    })

    const authenticationHeaders = {
      Origin: extensionOrigin,
      "X-INSU-Extension-Protocol": String(
        EXTENSION_CONNECTION_PROTOCOL_VERSION,
      ),
      "X-INSU-Extension-Token": claimed.connectionToken,
    }
    expect(
      (
        await app.request(`${origin}/api/extension/health`, {
          headers: {
            Origin: extensionOrigin,
            "X-INSU-Extension-Token": claimed.connectionToken,
          },
        })
      ).status,
    ).toBe(409)
    const health = await app.request(`${origin}/api/extension/health`, {
      headers: authenticationHeaders,
    })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      ok: true,
      extensionProtocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      libraryUrl: `${origin}/extension/library`,
    })

    const secretCookie = "browser-cookie-must-stay-ephemeral"
    const mediaSession = await app.request(
      `${origin}/api/extension/media-sessions`,
      {
        method: "POST",
        headers: {
          ...authenticationHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          candidates: [
            {
              kind: "page",
              pageUrl: "https://example.test/video",
              candidateFingerprint: "b".repeat(64),
            },
          ],
          cookies: [
            {
              name: "empty",
              value: "",
              domain: ".example.test",
              path: "/",
              secure: true,
              httpOnly: true,
              hostOnly: false,
              session: true,
            },
            {
              name: "session",
              value: secretCookie,
              domain: ".example.test",
              path: "/",
              secure: true,
              httpOnly: true,
              hostOnly: false,
              session: true,
            },
          ],
          authenticationConsentAt: "2026-08-11T00:00:00.000Z",
        }),
      },
    )
    expect(mediaSession.status).toBe(201)
    expect(await mediaSession.json()).toMatchObject({
      candidateFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    downloadQueueService.pause()
    const enqueue = await app.request(
      `${origin}/api/extension/library/items`,
      {
        method: "POST",
        headers: {
          ...authenticationHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rightsConfirmed: true,
          sources: [
            {
              kind: "page",
              pageUrl: "https://example.test/video",
              candidateFingerprint: "c".repeat(64),
            },
          ],
        }),
      },
    )
    expect(enqueue.status).toBe(202)
    const enqueued = (await enqueue.json()) as {
      accepted: boolean
      itemIds: string[]
    }
    expect(enqueued.accepted).toBe(true)
    expect(enqueued.itemIds).toHaveLength(1)
    expect(enqueued.itemIds[0]?.startsWith("library-")).toBe(true)

    const database = readFileSync(path.join(workspace, "app.db"))
    expect(database.includes(Buffer.from(secretCookie))).toBe(false)
    expect(database.includes(Buffer.from(invitation.ticket))).toBe(false)
    expect(database.includes(Buffer.from(claimed.connectionToken))).toBe(false)

    const revoke = await app.request(`${origin}/api/extension/pairing`, {
      method: "DELETE",
      headers: { Origin: origin },
    })
    expect(revoke.status).toBe(200)
    expect(
      (
        await app.request(`${origin}/api/extension/health`, {
          headers: authenticationHeaders,
        })
      ).status,
    ).toBe(401)
  })

  test("rejects an older media record schema without a fallback reader", async () => {
    mutateStatus((status) => {
      status.schemaVersion = 5
    })
    const response = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video",
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "media item record must use schemaVersion 3",
    })
    expect(
      sqlite.query("select count(*) as count from media_items").get(),
    ).toEqual({ count: 1 })
  })

  test("rejects a media record without current history fields", async () => {
    mutateStatus((status) => {
      status.history = [
        {
          at: "2026-08-08T00:00:00.000Z",
          state: "ready",
          message: "舊紀錄缺少 stage",
        },
      ]
    })
    const response = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video",
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "media item record contains an invalid history entry",
    })
  })

  test("uses the SQLite playback default when no playback row exists", async () => {
    const response = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video",
    )
    expect(response.status).toBe(200)
    expect((await response.json()).playback).toMatchObject({
      time: 0,
      duration: null,
      captionLanguage: null,
    })
  })

  test("returns the subtitle catalog, artifact comparison, and active bilingual rows", async () => {
    const catalogResponse = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/subtitles",
    )
    expect(catalogResponse.status).toBe(200)
    const catalog = (await catalogResponse.json()) as {
      artifacts: Array<{
        id: string
        kind: string
        tracks: Array<{ id: string; languageCode: string }>
      }>
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
    const outputTrack = artifact?.tracks.find(
      ({ languageCode }) => languageCode === "zh-TW",
    )
    const exportedText = await app.request(
      `http://127.0.0.1:4178/api/jobs/demo-video/subtitles/artifacts/${artifact?.id}/tracks/${outputTrack?.id}/export?format=txt`,
    )
    expect(exportedText.status).toBe(200)
    expect(exportedText.headers.get("content-disposition")).toContain("attachment")
    expect(await exportedText.text()).toBe("完整句子\n")

    const exportedSrt = await app.request(
      `http://127.0.0.1:4178/api/jobs/demo-video/subtitles/artifacts/${artifact?.id}/tracks/${outputTrack?.id}/export?format=srt`,
    )
    expect(exportedSrt.status).toBe(200)
    expect(await exportedSrt.text()).toContain(
      "1\n00:00:00,000 --> 00:00:02,000\n完整句子",
    )

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
    const savedRecord = sqlite
      .query("SELECT record_json FROM media_items WHERE video_id = ?")
      .get("demo-video") as { record_json: string }
    expect(JSON.parse(savedRecord.record_json).activeSubtitleTracks).toEqual({
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

  test("persists subtitle styles and saved presets through the current API", async () => {
    const origin = "http://127.0.0.1:4178"
    const custom = {
      ...DEFAULT_SUBTITLE_STYLES,
      primary: { ...DEFAULT_SUBTITLE_STYLES.primary, fontScale: 1.25 },
    }
    const created = await app.request(`${origin}/api/subtitle-styles/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "大字模式", styles: custom }),
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      active: custom,
      presets: [{ name: "大字模式", styles: custom }],
    })

    const catalog = await app.request(`${origin}/api/subtitle-styles`)
    expect(await catalog.json()).toMatchObject({
      active: custom,
      activePresetId: expect.stringMatching(/^subtitle-style-/),
    })
  })

  test("imports one authorized local file and publishes it as playable media", async () => {
    const origin = "http://127.0.0.1:4178"
    const bytes = new TextEncoder().encode("test-mp4")
    const created = await app.request(`${origin}/api/library/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        originalName: "Local Clip.mp4",
        title: "Local Clip",
        sizeBytes: bytes.byteLength,
        contentType: "video/mp4",
        rightsConfirmed: true,
      }),
    })
    expect(created.status).toBe(201)
    const metadata = (await created.json()) as {
      importId: string
      uploadUrl: string
    }
    expect(metadata.importId).toMatch(/^local-import-/)

    const pending = await app.request(`${origin}/api/library`)
    const pendingLibrary = (await pending.json()) as {
      items: Array<Record<string, unknown>>
    }
    expect(
      pendingLibrary.items.find((item) => item.id === metadata.importId),
    ).toMatchObject({ kind: "import", state: "awaiting_upload" })

    const uploaded = await app.request(`${origin}${metadata.uploadUrl}`, {
      method: "PUT",
      headers: {
        Origin: origin,
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.byteLength),
      },
      body: bytes,
    })
    expect(uploaded.status).toBe(202)
    const completed = (await uploaded.json()) as { videoId: string }
    expect(completed.videoId).toMatch(/^local-[0-9a-f]{16}$/)

    const library = await app.request(`${origin}/api/library`)
    const completedLibrary = (await library.json()) as {
      items: Array<{ kind: string; job?: Record<string, unknown> }>
    }
    expect(
      completedLibrary.items.find(
        (item) => item.job?.videoId === completed.videoId,
      ),
    ).toMatchObject({
      kind: "media",
      job: {
        videoId: completed.videoId,
        sourceUrl: null,
        sourceKind: "local-file",
        watchable: true,
      },
    })
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
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
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

  test("persists playback only in the app database", async () => {
    const response = await app.request(
      "http://127.0.0.1:4178/api/jobs/demo-video/playback",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
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

  test("rejects cross-origin provider credential mutation and path-shaped video IDs", async () => {
    const credential = await app.request(
      "http://127.0.0.1:4178/api/providers/openai/credential",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://untrusted.example",
        },
        body: JSON.stringify({ value: "not-a-real-key" }),
      },
    )
    expect(credential.status).toBe(403)

    const traversal = await app.request(
      "http://127.0.0.1:4178/api/jobs/%2e%2e%2fstatus",
    )
    expect(traversal.status).toBe(404)
  })

  test("owns one session credential per supported cloud provider without exposing its value", async () => {
    const providers = [
      ["openai", "OPENAI_API_KEY"],
      ["groq", "GROQ_API_KEY"],
      ["elevenlabs", "ELEVENLABS_API_KEY"],
      ["xai", "XAI_API_KEY"],
      ["openrouter", "OPENROUTER_API_KEY"],
    ]
    for (const [providerId, credentialName] of providers) {
      const secret = `not-a-real-${providerId}-key`
      const configured = await app.request(
        `http://127.0.0.1:4178/api/providers/${providerId}/credential`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1:4178",
          },
          body: JSON.stringify({ value: secret }),
        },
      )
      expect(configured.status).toBe(200)
      const rawPayload = await configured.text()
      expect(rawPayload).not.toContain(secret)
      const configuredPayload = JSON.parse(rawPayload) as {
        providers: Array<Record<string, unknown>>
      }
      expect(
        configuredPayload.providers.find((provider) => provider.id === providerId),
      ).toMatchObject({
        id: providerId,
        credentialName,
        configured: true,
        source: "session",
      })

      const cleared = await app.request(
        `http://127.0.0.1:4178/api/providers/${providerId}/credential`,
        {
          method: "DELETE",
          headers: { Origin: "http://127.0.0.1:4178" },
        },
      )
      expect(cleared.status).toBe(200)
    }

    const rejected = await app.request(
      "http://127.0.0.1:4178/api/providers/unsupported/credential",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({ value: "no" }),
      },
    )
    expect(rejected.status).toBe(404)
  })

  test("publishes one current model catalog and protects model mutations", async () => {
    const inventory = await app.request("http://127.0.0.1:4178/api/models")
    expect(inventory.status).toBe(200)
    const payload = (await inventory.json()) as {
      models: Array<{ id: string; type: string; selected: boolean; timingUnitKind: string }>
      providers: Array<{ id: string; modelIds: string[] }>
      selectedModelId: string | null
    }
    expect(payload.models[0]?.id).toBe("local.openai-whisper.tiny")
    expect(payload.models.some((model) => model.id === "cloud.openai.whisper-1")).toBe(true)
    expect(payload.models.every((model) => model.timingUnitKind === "word")).toBe(true)
    expect(payload.providers.map((provider) => provider.id)).toEqual([
      "openai",
      "groq",
      "elevenlabs",
      "xai",
      "openrouter",
    ])
    expect(payload.selectedModelId).toBeNull()

    const crossOrigin = await app.request(
      "http://127.0.0.1:4178/api/models/local.openai-whisper.tiny/download",
      { method: "POST", headers: { Origin: "https://untrusted.example" } },
    )
    expect(crossOrigin.status).toBe(403)

    const cloudDownload = await app.request(
      "http://127.0.0.1:4178/api/models/cloud.openai.whisper-1/download",
      { method: "POST", headers: { Origin: "http://127.0.0.1:4178" } },
    )
    expect(cloudDownload.status).toBe(400)
  })

  test("uses exact model IDs and leaves every removed settings contract unavailable", async () => {
    const origin = "http://127.0.0.1:4178"
    const selected = await app.request(`${origin}/api/models/selection`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ modelId: "cloud.groq.whisper-large-v3-turbo" }),
    })
    expect(selected.status).toBe(409)

    const detail = await app.request(`${origin}/api/models/cloud.groq.whisper-large-v3-turbo`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      model: {
        id: "cloud.groq.whisper-large-v3-turbo",
        type: "cloud",
        provider: "groq",
        ready: false,
      },
      provider: { id: "groq", credentialName: "GROQ_API_KEY" },
    })

    for (const route of [
      "/api/environment",
      "/api/transcription-settings",
      "/api/models/local/tiny/download",
      "/api/models/local/active",
    ]) {
      expect((await app.request(`${origin}${route}`)).status).toBe(404)
    }
  })

  test("rejects playlists before creating library items", async () => {
    const response = await app.request(
      "http://127.0.0.1:4178/api/library/items",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:4178",
        },
        body: JSON.stringify({
          sources: [
            {
              kind: "page",
              pageUrl: "https://example.test/watch?v=one&list=playlist",
            },
          ],
          rightsConfirmed: true,
        }),
      },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "不接受播放清單網址" })
    const library = await app.request("http://127.0.0.1:4178/api/library")
    expect(await library.json()).toMatchObject({
      items: [{ kind: "media", id: "media:demo-video" }],
      queue: { queuedCount: 0, activeCount: 0 },
    })
    expect(
      (await app.request("http://127.0.0.1:4178/api/download-batches")).status,
    ).toBe(404)
  })

  test("requires content rights and accepts a fresh download of existing media", async () => {
    const origin = "http://127.0.0.1:4178"
    const missingRights = await app.request(`${origin}/api/library/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        sources: [{ kind: "page", pageUrl: "https://example.test/video" }],
        rightsConfirmed: false,
      }),
    })
    expect(missingRights.status).toBe(400)
    expect(await missingRights.json()).toMatchObject({
      error: "開始下載前請先確認內容權利",
    })

    downloadQueueService.pause()
    const response = await app.request(`${origin}/api/library/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        sources: [{ kind: "page", pageUrl: "https://example.test/video" }],
        rightsConfirmed: true,
      }),
    })
    expect(response.status).toBe(202)
    const created = (await response.json()) as {
      accepted: boolean
      itemIds: string[]
    }
    expect(created.accepted).toBe(true)
    expect(created.itemIds).toHaveLength(1)
    expect(created.itemIds[0]?.startsWith("library-")).toBe(true)
    expect(downloadQueueService.list()).toMatchObject({
      items: [
        { id: created.itemIds[0], kind: "download", state: "queued" },
        { id: "media:demo-video", kind: "media" },
      ],
      queue: { queuedCount: 1 },
    })

    const repeated = await app.request(`${origin}/api/library/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        sources: [
          { kind: "page", pageUrl: "https://example.test/video" },
          { kind: "page", pageUrl: "https://example.test/video" },
        ],
        rightsConfirmed: true,
      }),
    })
    expect(repeated.status).toBe(202)
    expect(await repeated.json()).toEqual({
      accepted: true,
      itemIds: [created.itemIds[0], created.itemIds[0]],
    })
  })

  test("keeps one stable library item ID when a download becomes playable", async () => {
    const timestamp = "2026-08-11T01:00:00.000Z"
    sqlite
      .query(
        "INSERT INTO operations (id, video_id, parent_operation_id, kind, state, stage, progress, message, inputs_json, outputs_json, consent_json, resumable, attempt, pid, error_code, error_message, created_at, started_at, updated_at, completed_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, NULL, NULL, ?, ?, ?, ?)",
      )
      .run(
        "operation-complete-download",
        "demo-video",
        "media-download",
        "downloaded",
        "complete",
        100,
        "影音已下載，等待處理",
        "{}",
        '{"videoId":"demo-video"}',
        '{"rightsConfirmed":true}',
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      )
    sqlite
      .query(
        "INSERT INTO download_queue_items (id, source_kind, page_url, source_url, source_key, session_id, operation_id, video_id, rights_confirmed, low_quality_approved, authentication, authentication_consent_at, created_at, completed_at) VALUES (?, 'page', ?, ?, ?, NULL, ?, ?, 1, 0, 'none', NULL, ?, ?)",
      )
      .run(
        "library-stable-demo",
        "https://example.test/video",
        "https://example.test/video",
        "page:https://example.test/video",
        "operation-complete-download",
        "demo-video",
        timestamp,
        timestamp,
      )

    expect(downloadQueueService.list()).toMatchObject({
      items: [
        {
          id: "library-stable-demo",
          kind: "media",
          job: { videoId: "demo-video", watchable: true },
        },
      ],
      queue: { activeCount: 0, queuedCount: 0 },
    })

    downloadQueueService.pause()
    expect(
      downloadQueueService.create(
        [{ kind: "page", pageUrl: "https://example.test/video" }],
        true,
      ),
    ).toEqual({ accepted: true, itemIds: ["library-stable-demo"] })
    expect(downloadQueueService.list()).toMatchObject({
      items: [
        { id: "library-stable-demo", kind: "download", state: "queued" },
        { id: "media:demo-video", kind: "media" },
      ],
      queue: { activeCount: 0, queuedCount: 1 },
    })
    const redownloadInputs = sqlite
      .query("select inputs_json from operations where id = ?")
      .get("operation-complete-download") as { inputs_json: string }
    expect(JSON.parse(redownloadInputs.inputs_json)).toMatchObject({
      redownloadBaselineUpdatedAt:
        jobRepository.listDownloadProjections()[0]?.updatedAt,
    })
  })

  test("reconciles a stale failed extension download from published media without its consumed session", () => {
    seedDownloadItem({
      itemId: "library-published-demo",
      operationId: "operation-published-demo",
      sourceUrl: "https://example.test/video",
      videoId: "demo-video",
      sessionId: "media-session-00000000-0000-4000-8000-000000000000",
      resumable: false,
    })

    const library = downloadQueueService.list()
    expect(library).toMatchObject({
      items: [
        {
          id: "library-published-demo",
          kind: "media",
          job: { videoId: "demo-video", watchable: true },
        },
      ],
      queue: { activeCount: 0, queuedCount: 0, attentionCount: 0 },
    })
    expect(
      sqlite
        .query(
          "select video_id, state, stage, progress, error_code, error_message from operations where id = ?",
        )
        .get("operation-published-demo"),
    ).toEqual({
      video_id: "demo-video",
      state: "downloaded",
      stage: "complete",
      progress: 100,
      error_code: null,
      error_message: null,
    })
    expect(
      sqlite
        .query(
          "select state, stage from operation_events where operation_id = ? order by sequence desc limit 1",
        )
        .get("operation-published-demo"),
    ).toEqual({ state: "downloaded", stage: "complete" })

    expect(downloadQueueService.start("library-published-demo")).toMatchObject({
      items: [{ id: "library-published-demo", kind: "media" }],
    })
  })

  test("deletes a failed download item and its operation without touching media", async () => {
    const origin = "http://127.0.0.1:4178"
    seedDownloadItem({
      itemId: "library-failed-removal",
      operationId: "operation-failed-removal",
      sourceUrl: "https://example.test/failed-removal",
    })

    const forbidden = await app.request(
      `${origin}/api/library/items/library-failed-removal`,
      { method: "DELETE", headers: { Origin: "https://untrusted.example" } },
    )
    expect(forbidden.status).toBe(403)

    const removed = await app.request(
      `${origin}/api/library/items/library-failed-removal`,
      { method: "DELETE", headers: { Origin: origin } },
    )
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({
      items: [{ kind: "media", job: { videoId: "demo-video" } }],
      queue: { attentionCount: 0 },
    })
    expect(
      sqlite
        .query("select count(*) as count from download_queue_items where id = ?")
        .get("library-failed-removal"),
    ).toEqual({ count: 0 })
    expect(
      sqlite
        .query("select count(*) as count from operations where id = ?")
        .get("operation-failed-removal"),
    ).toEqual({ count: 0 })
    expect(
      sqlite.query("select count(*) as count from media_items").get(),
    ).toEqual({ count: 1 })
  })

  test("persists the global queue pause without starting newly added items", async () => {
    const origin = "http://127.0.0.1:4178"
    const paused = await app.request(`${origin}/api/download-queue/pause`, {
      method: "POST",
      headers: { Origin: origin },
    })
    expect(paused.status).toBe(200)
    expect(await paused.json()).toMatchObject({ queue: { paused: true } })

    const created = await app.request(`${origin}/api/library/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        sources: [
          { kind: "page", pageUrl: "https://example.test/queued-one" },
          { kind: "page", pageUrl: "https://example.test/queued-two" },
        ],
        rightsConfirmed: true,
      }),
    })
    expect(created.status).toBe(202)
    const library = await app.request(`${origin}/api/library`)
    expect(await library.json()).toMatchObject({
      items: [
        { kind: "download", state: "queued", queueAhead: 0 },
        { kind: "download", state: "queued", queueAhead: 1 },
        { kind: "media", id: "media:demo-video" },
      ],
      queue: { paused: true, queuedCount: 2, activeCount: 0 },
    })
  })

  test("keeps health and library APIs available while an unpublished download is active", async () => {
    const timestamp = "2026-08-11T01:00:00.000Z"
    sqlite
      .query(
        "INSERT INTO operations (id, video_id, parent_operation_id, kind, state, stage, progress, message, inputs_json, outputs_json, consent_json, resumable, attempt, pid, error_code, error_message, created_at, started_at, updated_at, completed_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, NULL, ?, ?, ?, NULL)",
      )
      .run(
        "operation-active-download",
        null,
        "media-download",
        "downloading",
        "media_download",
        10,
        "正在下載影音",
        "{}",
        "{}",
        "{}",
        process.pid,
        timestamp,
        timestamp,
        timestamp,
      )
    sqlite
      .query(
        "INSERT INTO operation_events (operation_id, sequence, type, state, stage, progress, message, data_json, created_at) VALUES (?, 1, 'created', 'downloading', 'media_download', 10, '正在下載影音', '{}', ?)",
      )
      .run("operation-active-download", timestamp)
    sqlite
      .query(
        "INSERT INTO download_queue_items (id, source_kind, page_url, source_url, source_key, session_id, operation_id, video_id, rights_confirmed, low_quality_approved, authentication, authentication_consent_at, created_at, completed_at) VALUES (?, 'page', ?, ?, ?, NULL, ?, NULL, 1, 0, 'none', NULL, ?, NULL)",
      )
      .run(
        "library-active-download",
        "https://example.test/active-download",
        "https://example.test/active-download",
        "page:https://example.test/active-download",
        "operation-active-download",
        timestamp,
      )

    expect(
      existsSync(path.join(workspace, "jobs", "active-download", "media-work", "catalog.json")),
    ).toBe(false)
    const library = await app.request("http://127.0.0.1:4178/api/library")
    expect(library.status).toBe(200)
    expect(await library.json()).toMatchObject({
      items: [
        {
          id: "library-active-download",
          kind: "download",
          state: "downloading",
          stage: "media_download",
          progress: 10,
        },
        {
          id: "media:demo-video",
          kind: "media",
          job: { videoId: "demo-video" },
        },
      ],
      queue: { activeCount: 1, queuedCount: 0 },
    })
    const health = await app.request("http://127.0.0.1:4178/api/health")
    expect(health.status).toBe(200)
  })

  test("keeps serving health while a download child runs and after it fails", async () => {
    const fakeDownload = path.join(workspace, "fake-download.sh")
    writeFileSync(fakeDownload, "#!/bin/sh\nsleep 1\nexit 7\n")
    chmodSync(fakeDownload, 0o700)
    const downloads = new DownloadQueueService(
      workspace,
      database,
      jobRepository,
      fakeDownload,
      mediaSessionService,
      1,
    )
    const created = downloads.create(
      [{ kind: "page", pageUrl: "https://example.test/process-liveness" }],
      true,
    )
    let current = downloads.list().items.find((item) => item.id === created.itemIds[0])
    expect(current).toMatchObject({ kind: "download", state: "checking", progress: 1 })

    for (let index = 0; index < 5; index += 1) {
      const health = await app.request("http://127.0.0.1:4178/api/health")
      expect(health.status).toBe(200)
    }

    const deadline = Date.now() + 3_000
    while (current?.kind === "download" && current.state === "checking" && Date.now() < deadline) {
      await Bun.sleep(25)
      current = downloads.list().items.find((item) => item.id === created.itemIds[0])
    }
    expect(current).toMatchObject({
      kind: "download",
      state: "failed",
      errorCode: "download-failed",
    })
    expect(
      (await app.request("http://127.0.0.1:4178/api/health")).status,
    ).toBe(200)
  })

  test("pauses, resumes, and removes an unfinished download with its partial files", async () => {
    const fakeDownload = path.join(workspace, "fake-pausable-download.sh")
    writeFileSync(
      fakeDownload,
      "#!/bin/sh\ntrap 'exit 143' TERM INT\nwhile :; do sleep 1; done\n",
    )
    chmodSync(fakeDownload, 0o700)
    const downloads = new DownloadQueueService(
      workspace,
      database,
      jobRepository,
      fakeDownload,
      mediaSessionService,
      1,
    )
    const created = downloads.create(
      [{ kind: "page", pageUrl: "https://example.test/pausable-download" }],
      true,
    )
    const itemId = created.itemIds[0]!

    expect(downloads.list().items.find((item) => item.id === itemId)).toMatchObject({
      kind: "download",
      state: "checking",
    })
    expect(await downloads.pauseItem(itemId)).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: itemId, kind: "download", state: "paused" }),
      ]),
    })

    downloads.start(itemId)
    expect(downloads.list().items.find((item) => item.id === itemId)).toMatchObject({
      kind: "download",
      state: "checking",
    })
    const operation = sqlite
      .query("select operation_id from download_queue_items where id = ?")
      .get(itemId) as { operation_id: string }
    const operationInputs = sqlite
      .query("select inputs_json from operations where id = ?")
      .get(operation.operation_id) as { inputs_json: string }
    expect(JSON.parse(operationInputs.inputs_json)).toMatchObject({
      resumePartial: true,
    })

    const published = jobRepository.listDownloadProjections().find(
      (job) => job.videoId === "demo-video",
    )!
    const inputs = {
      ...JSON.parse(operationInputs.inputs_json),
      redownloadBaselineUpdatedAt: published.updatedAt,
    }
    sqlite
      .query("update download_queue_items set video_id = ? where id = ?")
      .run("demo-video", itemId)
    sqlite
      .query("update operations set video_id = ?, inputs_json = ? where id = ?")
      .run("demo-video", JSON.stringify(inputs), operation.operation_id)
    const partialDirectory = path.join(
      workspace,
      "jobs",
      "demo-video",
      "source",
      ".video-download-test",
    )
    mkdirSync(partialDirectory, { recursive: true })
    writeFileSync(path.join(partialDirectory, "video.mp4.part"), "partial")

    const removed = await downloads.remove(itemId)
    expect(removed.items).toEqual([
      expect.objectContaining({ kind: "media", job: expect.objectContaining({ videoId: "demo-video" }) }),
    ])
    expect(existsSync(partialDirectory)).toBe(false)
    expect(existsSync(path.join(workspace, "jobs", "demo-video"))).toBe(true)
    expect(
      sqlite.query("select count(*) as count from download_queue_items where id = ?").get(itemId),
    ).toEqual({ count: 0 })
    expect(
      sqlite.query("select count(*) as count from operations where id = ?").get(operation.operation_id),
    ).toEqual({ count: 0 })
  })

  test("imports immutable text and mind-map summary revisions with exact dependencies", async () => {
    const origin = "http://127.0.0.1:4178"
    const translationId = "demo-video-translation-en-zh-TW-r1"
    const text = await app.request(`${origin}/api/jobs/demo-video/summaries/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        kind: "text",
        languageCode: "zh-TW",
        title: "測試摘要",
        content: "# 測試摘要\n\n這是完整句摘要。",
        sourceSubtitleArtifactId: translationId,
      }),
    })
    expect(text.status).toBe(201)
    const textPayload = (await text.json()) as {
      activeArtifactIds: { text: string }
    }
    const textId = textPayload.activeArtifactIds.text
    expect(textId).toBe("demo-video-text-zh-TW-r1")

    const mindmap = await app.request(`${origin}/api/jobs/demo-video/summaries/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        kind: "mindmap",
        languageCode: "zh-TW",
        title: "測試心智圖",
        content: "# 測試心智圖\n- 核心觀點\n  - 完整句摘要",
        sourceSummaryArtifactId: textId,
      }),
    })
    expect(mindmap.status).toBe(201)

    const artifact = await app.request(
      `${origin}/api/jobs/demo-video/summaries/${textId}`,
    )
    expect(artifact.status).toBe(200)
    expect(await artifact.json()).toMatchObject({
      artifact: {
        id: textId,
        processor: { provider: "agent", service: "codex" },
        dependencies: [{ type: "subtitle", id: translationId }],
      },
      content: "# 測試摘要\n\n這是完整句摘要。",
    })

    const removalPreview = await app.request(`${origin}/api/removals/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        target: {
          kind: "summary-artifact",
          videoId: "demo-video",
          artifactId: textId,
        },
      }),
    })
    expect(removalPreview.status).toBe(200)
    expect(previewedTarget).toEqual({
      kind: "summary-artifact",
      videoId: "demo-video",
      artifactId: textId,
    })
  })
})
