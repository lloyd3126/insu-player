import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { createApplication } from "@server/app"
import { openAppDatabase } from "@server/db/client"
import { jobs as mediaItems } from "@server/db/schema"
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
import type { MediaOperations } from "@server/services/media-service"
import { ResourceService } from "@server/services/resource-service"
import { RuntimeService } from "@server/services/runtime-service"
import { SummaryService } from "@server/services/summary-service"
import { SubtitleStyleService } from "@server/services/subtitle-style-service"
import type { MediaOperation } from "@shared/contracts/media"

const root = path.resolve(import.meta.dir, "../..")
const workspace = mkdtempSync(path.join(tmpdir(), "insu-player-e2e-"))
const job = path.join(workspace, "jobs", "demo-video")
const port = Number(process.env.INSU_E2E_PORT ?? 42871)

const renditionRoot = path.join(job, "source", "renditions")
mkdirSync(renditionRoot, { recursive: true })
mkdirSync(path.join(job, "logs"), { recursive: true })
const mediaContents = "fake media payload"
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
    availability: {
      discoveredAt: "2026-08-08T00:00:00.000Z",
      formats: [
        { height: 720, width: 1280, fps: 30, estimatedBytes: 18, container: "mp4", videoCodec: "avc1" },
        { height: 1080, width: 1920, fps: 30, estimatedBytes: 40, container: "mp4", videoCodec: "avc1" },
      ],
    },
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
const english = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nFor the last month I have been experimenting with vibe coding and collecting the practices that produce measurably better results\n\n00:00:03.000 --> 00:00:06.000\nThe second English sentence\n"
const chinese = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n過去一個月我一直在嘗試 Vibe Coding 並整理能帶來明顯更好成果的實作方式\n\n00:00:03.000 --> 00:00:06.000\n第二個繁體中文句子\n"
const sourceId = "artifact-demo-video-source-model-transcript-en-r1"
const proofreadId = "artifact-demo-video-proofread-en-en-r1"
const translationId = "artifact-demo-video-translation-en-zh-TW-r1"
const segmentationId = "artifact-demo-video-segmentation-en-zh-TW-r1"
function contentManifest(mode: "proofread" | "translate", outputLanguage: string) {
  return `${JSON.stringify({
  schemaVersion: 5,
  mode,
  sourceFormat: "model-timed-units",
  sourceLanguage: "en",
  outputLanguage,
  sourceTranscript: "transcript.json",
  timingSourceArtifactId: sourceId,
  sourceContentArtifactId: sourceId,
  sourceContentKind: "model-transcript",
  sourceContentManifest: null,
  sourceContentChecksum: null,
  referenceArtifactIds: [],
  timingProcessor: { provider: "local", service: "openai-whisper", model: "medium" },
  contentProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-08T01:00:00.000Z" },
  sentenceReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-08T01:00:00.000Z" },
  outputProfile: {},
  rules: {},
  segments: [],
  })}\n`
}
const proofreadArtifactManifest = contentManifest("proofread", "en")
const contentArtifactManifest = contentManifest("translate", "zh-TW")
const segmentationArtifactManifest = `${JSON.stringify({
  schemaVersion: 4,
  contentMode: "translate",
  sourceLanguage: "en",
  outputLanguage: "zh-TW",
  sourceTranscript: "transcript.json",
  contentManifest: "content.json",
  sourceContentArtifactId: sourceId,
  sourceContentKind: "model-transcript",
  timingProcessor: { provider: "local", service: "openai-whisper", model: "medium" },
  contentProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-08T01:00:00.000Z" },
  sentenceReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-08T01:00:00.000Z" },
  segmentationProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-08T01:00:00.000Z" },
  alignmentMethod: "agent-semantic",
  alignmentReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-08T01:00:00.000Z" },
  alignmentFingerprint: "0".repeat(64),
  targetRevision: 1,
  targetFrozen: true,
  targetFingerprint: "0".repeat(64),
  targetFrozenAt: "2026-08-08T01:05:00.000Z",
  widthProfile: {},
  timingProfile: {},
  outputProfile: {},
  timedUnits: [],
  boundaryHints: [],
  contentUnits: [],
})}\n`
for (const artifactId of [sourceId, proofreadId, translationId, segmentationId]) {
  const artifactRoot = path.join(job, "subtitle-work", "artifacts", artifactId)
  mkdirSync(artifactRoot, { recursive: true })
  if (artifactId === sourceId) {
    writeFileSync(path.join(artifactRoot, "source.vtt"), english)
  } else {
    writeFileSync(path.join(artifactRoot, "input.vtt"), english)
    writeFileSync(
      path.join(artifactRoot, "output.vtt"),
      artifactId === proofreadId ? english : chinese,
    )
    writeFileSync(
      path.join(artifactRoot, "manifest.json"),
      artifactId === segmentationId
        ? segmentationArtifactManifest
        : artifactId === proofreadId
          ? proofreadArtifactManifest
          : contentArtifactManifest,
    )
  }
}
const digest = (contents: string) => createHash("sha256").update(contents).digest("hex")
const artifactDigest = (
  tracks: Array<[string, string]>,
  manifestContents?: string,
) => {
  const hasher = createHash("sha256")
  for (const [language, trackChecksum] of tracks) {
    hasher.update(language, "utf8")
    hasher.update(trackChecksum, "ascii")
  }
  if (manifestContents !== undefined) {
    hasher.update(createHash("sha256").update(manifestContents).digest())
  }
  return hasher.digest("hex")
}
writeFileSync(
  path.join(job, "logs", "workflow.log"),
  "download complete\ntranscription complete\nsubtitle reflow complete\n",
)
const mediaRecord = {
    schemaVersion: 3,
    videoId: "demo-video",
    title: "雙語測試影音",
    sourceUrl: "https://example.test/demo",
    sourceKind: "page",
    state: "ready",
    stage: "complete",
    progress: 1,
    message: "字幕已完成",
    durationSeconds: 125.9,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T02:30:00.000Z",
    completedAt: "2026-08-08T02:30:00.000Z",
    assets: {
      mediaCatalog: {
        path: "media-work/catalog.json",
        bytes: 1,
        updatedAt: "2026-08-08T02:30:00.000Z",
      },
    },
    subtitlePipeline: {
      mode: "translate",
      stage: "complete",
      sourceLanguage: "en",
      outputLanguage: "zh-TW",
      timingProcessor: {
        provider: "local",
        service: "openai-whisper",
        model: "medium",
      },
      contentProcessor: { provider: "agent", service: "codex" },
      segmentationProcessor: { provider: "agent", service: "codex" },
      manualReferenceArtifactIds: [],
      updatedAt: "2026-08-08T02:30:00.000Z",
    },
    subtitleArtifacts: [
      {
        id: sourceId,
        kind: "source",
        revision: 1,
        lifecycleState: "ready",
        validationState: "valid",
        freshnessState: "current",
        sourceLanguage: "en",
        outputLanguage: null,
        sourceType: "model-transcript",
        processor: {
          provider: "local",
          service: "openai-whisper",
          model: "medium",
        },
        timingUnitKind: "word",
        targetFrozen: false,
        manifestPath: null,
        checksum: artifactDigest([["en", digest(english)]]),
        warningCount: 0,
        hardDefectCount: 0,
        dependencies: [],
        createdAt: "2026-08-08T00:30:00.000Z",
        completedAt: "2026-08-08T00:45:00.000Z",
        tracks: [
          {
            id: `${sourceId}-source_raw`,
            languageCode: "en",
            role: "source_raw",
            state: "ready",
            path: `subtitle-work/artifacts/${sourceId}/source.vtt`,
            checksum: digest(english),
            updatedAt: "2026-08-08T00:45:00.000Z",
          },
        ],
      },
      {
        id: proofreadId,
        kind: "proofread",
        revision: 1,
        lifecycleState: "ready",
        validationState: "valid",
        freshnessState: "current",
        sourceLanguage: "en",
        outputLanguage: "en",
        sourceType: null,
        processor: { provider: "agent", service: "codex" },
        timingUnitKind: "word",
        targetFrozen: false,
        manifestPath: `subtitle-work/artifacts/${proofreadId}/manifest.json`,
        checksum: artifactDigest(
          [["en", digest(english)], ["en", digest(english)]],
          proofreadArtifactManifest,
        ),
        warningCount: 0,
        hardDefectCount: 0,
        dependencies: [
          { artifactId: sourceId, relation: "timing-source" },
          { artifactId: sourceId, relation: "content-source" },
        ],
        createdAt: "2026-08-08T00:50:00.000Z",
        completedAt: "2026-08-08T01:00:00.000Z",
        tracks: [
          {
            id: `${proofreadId}-input_sentence`,
            languageCode: "en",
            role: "input_sentence",
            state: "ready",
            path: `subtitle-work/artifacts/${proofreadId}/input.vtt`,
            checksum: digest(english),
            updatedAt: "2026-08-08T01:00:00.000Z",
          },
          {
            id: `${proofreadId}-output_sentence`,
            languageCode: "en",
            role: "output_sentence",
            state: "ready",
            path: `subtitle-work/artifacts/${proofreadId}/output.vtt`,
            checksum: digest(english),
            updatedAt: "2026-08-08T01:00:00.000Z",
          },
        ],
      },
      {
        id: translationId,
        kind: "translation",
        revision: 1,
        lifecycleState: "ready",
        validationState: "valid",
        freshnessState: "current",
        sourceLanguage: "en",
        outputLanguage: "zh-TW",
        sourceType: null,
        processor: { provider: "agent", service: "codex" },
        timingUnitKind: null,
        targetFrozen: false,
        manifestPath: `subtitle-work/artifacts/${translationId}/manifest.json`,
        checksum: artifactDigest(
          [["en", digest(english)], ["zh-TW", digest(chinese)]],
          contentArtifactManifest,
        ),
        warningCount: 0,
        hardDefectCount: 0,
        dependencies: [
          { artifactId: sourceId, relation: "timing-source" },
          { artifactId: sourceId, relation: "content-source" },
        ],
        createdAt: "2026-08-08T01:00:00.000Z",
        completedAt: "2026-08-08T01:30:00.000Z",
        tracks: [
          {
            id: `${translationId}-input_sentence`,
            languageCode: "en",
            role: "input_sentence",
            state: "ready",
            path: `subtitle-work/artifacts/${translationId}/input.vtt`,
            checksum: digest(english),
            updatedAt: "2026-08-08T01:30:00.000Z",
          },
          {
            id: `${translationId}-output_sentence`,
            languageCode: "zh-TW",
            role: "output_sentence",
            state: "ready",
            path: `subtitle-work/artifacts/${translationId}/output.vtt`,
            checksum: digest(chinese),
            updatedAt: "2026-08-08T01:30:00.000Z",
          },
        ],
      },
      {
        id: segmentationId,
        kind: "segmentation",
        revision: 1,
        lifecycleState: "ready",
        validationState: "warning",
        freshnessState: "current",
        sourceLanguage: "en",
        outputLanguage: "zh-TW",
        sourceType: null,
        processor: { provider: "agent", service: "codex" },
        timingUnitKind: null,
        targetFrozen: true,
        manifestPath: `subtitle-work/artifacts/${segmentationId}/manifest.json`,
        checksum: artifactDigest(
          [["en", digest(english)], ["zh-TW", digest(chinese)]],
          segmentationArtifactManifest,
        ),
        warningCount: 1,
        hardDefectCount: 0,
        dependencies: [
          { artifactId: sourceId, relation: "timing-source" },
          { artifactId: translationId, relation: "content-parent" },
        ],
        createdAt: "2026-08-08T02:00:00.000Z",
        completedAt: "2026-08-08T02:30:00.000Z",
        tracks: [
          {
            id: `${segmentationId}-input_segmented`,
            languageCode: "en",
            role: "input_segmented",
            state: "ready",
            path: `subtitle-work/artifacts/${segmentationId}/input.vtt`,
            checksum: digest(english),
            updatedAt: "2026-08-08T02:30:00.000Z",
          },
          {
            id: `${segmentationId}-output_segmented`,
            languageCode: "zh-TW",
            role: "output_segmented",
            state: "ready",
            path: `subtitle-work/artifacts/${segmentationId}/output.vtt`,
            checksum: digest(chinese),
            updatedAt: "2026-08-08T02:30:00.000Z",
          },
        ],
      },
    ],
    activeSubtitleTracks: {},
    lastError: null,
    process: null,
    transcription: {
      provider: "local",
      service: "openai-whisper",
      model: "medium",
      languageTag: "en",
      engineLanguage: "en",
      updatedAt: "2026-08-08T02:30:00.000Z",
    },
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
  }

const opened = openAppDatabase(
  path.join(workspace, "app.db"),
  path.join(root, "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql"),
)
opened.db.insert(mediaItems).values({
  videoId: mediaRecord.videoId,
  title: mediaRecord.title,
  sourceUrl: mediaRecord.sourceUrl,
  state: mediaRecord.state,
  effectiveState: mediaRecord.state,
  stage: mediaRecord.stage,
  progress: mediaRecord.progress,
  message: mediaRecord.message,
  createdAt: mediaRecord.createdAt,
  updatedAt: mediaRecord.updatedAt,
  completedAt: mediaRecord.completedAt,
  lastError: mediaRecord.lastError,
  watchable: true,
  sizeBytes: 0,
  durationSeconds: mediaRecord.durationSeconds,
  recordJson: mediaRecord,
  recordRevision: 1,
  projectedAt: mediaRecord.updatedAt,
}).run()
const removalDigest = "a".repeat(64)
const removals: RemovalOperations = {
  async preview(target) {
    return {
      schemaVersion: 1,
      target,
      planDigest: removalDigest,
      blocked: [],
      warnings: [],
    }
  },
  async execute(target, planDigest) {
    return {
      schemaVersion: 1,
      target,
      planDigest,
      removed: true,
    }
  },
}
let mediaOperation: MediaOperation | null = null
let mediaOperationPolls = 0
let downloadedMediaHeight: number | null = null
const media: MediaOperations = {
  catalog(videoId) {
    if (mediaOperation?.state === "downloading") {
      mediaOperationPolls += 1
      if (mediaOperationPolls >= 2) {
        downloadedMediaHeight = mediaOperation.requestedHeight
        mediaOperation = {
          ...mediaOperation,
          state: "ready",
          stage: "ready",
          progress: 100,
          message: `${downloadedMediaHeight}p 畫質已下載`,
          pid: null,
          updatedAt: "2026-08-08T00:00:02.000Z",
          completedAt: "2026-08-08T00:00:02.000Z",
        }
      }
    }
    return {
      schemaVersion: 1,
      videoId,
      revision: 1,
      activeRenditionId: "720p-demo",
      availableBytes: 10_000_000,
      sourceRefreshedAt: "2026-08-08T00:00:00.000Z",
      formats: [
        { height: 720, width: 1280, fps: 30, estimatedBytes: 18, container: "mp4", videoCodec: "avc1" },
        { height: 1080, width: 1920, fps: 30, estimatedBytes: 40, container: "mp4", videoCodec: "avc1" },
      ],
      renditions: [
        {
          id: "720p-demo",
          requestedHeight: 720,
          width: 1280,
          height: 720,
          container: "mp4",
          videoCodec: "avc1",
          audioCodec: "aac",
          sizeBytes: 18,
          checksum: "a".repeat(64),
          createdAt: "2026-08-08T00:00:00.000Z",
          active: true,
        },
        ...(downloadedMediaHeight
          ? [
              {
                id: `${downloadedMediaHeight}p-demo`,
                requestedHeight: downloadedMediaHeight,
                width: downloadedMediaHeight === 1080 ? 1920 : 426,
                height: downloadedMediaHeight,
                container: "mp4",
                videoCodec: "avc1",
                audioCodec: "aac",
                sizeBytes: 40,
                checksum: "b".repeat(64),
                createdAt: "2026-08-08T00:00:02.000Z",
                active: false,
              },
            ]
          : []),
      ],
      operation: mediaOperation,
    }
  },
  async refresh(videoId) {
    return this.catalog(videoId)
  },
  download(videoId, height) {
    mediaOperationPolls = 0
    downloadedMediaHeight = null
    mediaOperation = {
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
    }
    return { accepted: true, operation: mediaOperation }
  },
  activate(videoId) {
    return this.catalog(videoId)
  },
}
const jobs = new JobRepository(workspace, opened.db)
const mediaSessions = new MediaSessionService(workspace)
const downloads = new DownloadQueueService(
  workspace,
  opened.db,
  jobs,
  path.join(root, "plugins/insu-player/skills/watch-video/scripts/download-video.sh"),
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
const app = createApplication({
  jobs,
  downloads,
  imports,
  library: new LibraryService(downloads, imports),
  extensionPairing: new ExtensionPairingService(
    opened.db,
  ),
  extensionPackage: new ExtensionPackageService(
    path.join(root, "plugins/insu-player/chrome-extension"),
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
