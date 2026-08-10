import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  activeSubtitleTracks,
  jobAssets,
  jobHistory,
  jobs,
  mediaDownloadRuns,
  mediaRenditions,
  playbackStates,
  subtitleArtifactDependencies,
  subtitleArtifacts,
  subtitleArtifactTracks,
  subtitleRuns,
  subtitlePipelines,
} from "@server/db/schema"
import {
  atomicWriteJson,
  isRegularFile,
  readJsonFile,
  safeContainedFile,
} from "@server/lib/files"
import { STATUS_SCHEMA_VERSION } from "@server/runtime-contract"
import {
  activeMediaPath,
  mediaCatalogPath,
  publicMediaCatalog,
} from "@server/services/media-catalog-service"
import {
  isSelectableSubtitleTrack,
  publicSubtitleCatalog,
  resolveSubtitleCatalog,
  type ResolvedSubtitleCatalog,
} from "@server/services/subtitle-catalog-service"
import {
  JOB_STATES,
  SUBTITLE_PIPELINE_STAGES,
  type JobState,
  JobDetail,
  JobHistoryEntry,
  JobSummary,
  PlaybackState,
  SubtitlePipeline,
  TranscriptionSummary,
} from "@shared/contracts/job"
import type { SubtitleCatalogResponse } from "@shared/contracts/subtitle-catalog"
import type { ProcessorIdentity } from "@shared/contracts/processor"

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const LANGUAGE_PATTERN = /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/
const JOB_STAGE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const JOB_STATE_SET = new Set<string>(JOB_STATES)
const SUBTITLE_PIPELINE_STAGE_SET = new Set<string>(SUBTITLE_PIPELINE_STAGES)
const ACTIVE_STATES = new Set([
  "checking",
  "downloading",
  "transcribing",
  "proofreading",
  "translating",
  "segmenting",
  "preparing_player",
])

interface RawStatus {
  schemaVersion: number
  videoId: string
  title?: string
  sourceUrl?: string
  state: JobState
  stage: string
  progress: number
  message?: string
  createdAt?: string | null
  updatedAt?: string | null
  completedAt?: string | null
  lastError?: string | null
  process?: { pid?: number } | null
  assets?: Record<string, unknown>
  subtitlePipeline?: SubtitlePipeline | null
  subtitleArtifacts: unknown[]
  activeSubtitleTracks: Record<string, unknown>
  transcription?: TranscriptionSummary | null
  durationSeconds?: number | null
  history?: Array<Omit<JobHistoryEntry, "sequence">>
}

function processIsAlive(pid: unknown) {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function validProcessorIdentity(value: unknown, timingOnly = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const provider = candidate.provider
  const model =
    typeof candidate.model === "string" && candidate.model.trim()
      ? candidate.model.trim()
      : null
  const service =
    typeof candidate.service === "string" && candidate.service.trim()
      ? candidate.service.trim()
      : null
  if (provider === "local" || provider === "openai") return Boolean(model)
  return !timingOnly && provider === "agent" && Boolean(service)
}

export class JobRepository {
  readonly workspace: string
  readonly jobsRoot: string

  constructor(
    workspace: string,
    private readonly db: AppDatabase,
  ) {
    this.workspace = path.resolve(workspace)
    this.jobsRoot = path.join(this.workspace, "jobs")
    mkdirSync(this.jobsRoot, { recursive: true })
  }

  jobDirectory(videoId: string) {
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("invalid video ID")
    return path.join(this.jobsRoot, videoId)
  }

  private safeJobFile(jobDirectory: string, candidate: string) {
    return safeContainedFile(jobDirectory, candidate)
  }

  videoPath(videoId: string) {
    const directory = this.jobDirectory(videoId)
    return activeMediaPath(directory, videoId)
  }

  thumbnailPath(videoId: string) {
    const directory = this.jobDirectory(videoId)
    for (const extension of ["jpg", "jpeg", "png", "webp"]) {
      const candidate = this.safeJobFile(
        directory,
        path.join(directory, "source", `thumbnail.${extension}`),
      )
      if (candidate) return candidate
    }
    return null
  }

  private jobSize(directory: string) {
    let total = 0
    const visit = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) visit(candidate)
        if (entry.isFile()) {
          try {
            total += statSync(candidate).size
          } catch {
            // A workflow may atomically replace a file while the index is being read.
          }
        }
      }
    }
    visit(directory)
    return total
  }

  playbackState(videoId: string): PlaybackState {
    const statePath = path.join(this.jobDirectory(videoId), "ui-state.json")
    if (!isRegularFile(statePath)) {
      return {
        time: 0,
        duration: null,
        captionLanguage: null,
        updatedAt: null,
      }
    }
    try {
      const payload = readJsonFile<Record<string, unknown>>(statePath)
      const time = finiteNumber(payload.time)
      const duration = finiteNumber(payload.duration, Number.NaN)
      return {
        time: time >= 0 ? time : 0,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        captionLanguage:
          typeof payload.captionLanguage === "string"
            ? payload.captionLanguage
            : null,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      }
    } catch {
      return {
        time: 0,
        duration: null,
        captionLanguage: null,
        updatedAt: null,
      }
    }
  }

  savePlaybackState(
    videoId: string,
    payload: {
      time?: number
      duration?: number | null
      captionLanguage?: string | null
    },
  ) {
    const directory = this.jobDirectory(videoId)
    if (!existsSync(directory)) throw new Error("job not found")
    // Ensure the filesystem fact source is projected before the foreign-keyed UI state.
    this.summarize(videoId)
    if (
      payload.captionLanguage !== undefined &&
      payload.captionLanguage !== null &&
      !this.resolvedSubtitleCatalog(videoId).availableLanguageCodes.includes(
        payload.captionLanguage,
      )
    ) {
      throw new Error("caption language is unavailable")
    }
    const current = this.playbackState(videoId)
    const time = payload.time ?? current.time
    const duration =
      payload.duration === undefined ? current.duration : payload.duration
    if (!Number.isFinite(time) || time < 0) {
      throw new Error("time must be a non-negative finite number")
    }
    if (
      duration !== null &&
      (!Number.isFinite(duration) || duration <= 0 || time > duration + 5)
    ) {
      throw new Error("duration is invalid or time is beyond duration")
    }
    const normalized: PlaybackState = {
      time: Math.round(time * 1000) / 1000,
      duration:
        duration === null ? null : Math.round(Number(duration) * 1000) / 1000,
      captionLanguage:
        payload.captionLanguage === undefined
          ? (current.captionLanguage ?? null)
          : payload.captionLanguage,
      updatedAt: new Date().toISOString(),
    }
    atomicWriteJson(path.join(directory, "ui-state.json"), normalized)
    this.db
      .insert(playbackStates)
      .values({ videoId, ...normalized })
      .onConflictDoUpdate({
        target: playbackStates.videoId,
        set: normalized,
      })
      .run()
    return normalized
  }

  private loadRawStatus(videoId: string) {
    const statusPath = path.join(this.jobDirectory(videoId), "status.json")
    const status = readJsonFile<Record<string, unknown>>(statusPath)
    if (status.schemaVersion !== STATUS_SCHEMA_VERSION) {
      throw new Error(`status.json must use schemaVersion ${STATUS_SCHEMA_VERSION}`)
    }
    if (!Array.isArray(status.subtitleArtifacts)) {
      throw new Error("status.json must contain subtitleArtifacts")
    }
    if (
      !status.activeSubtitleTracks ||
      typeof status.activeSubtitleTracks !== "object" ||
      Array.isArray(status.activeSubtitleTracks)
    ) {
      throw new Error("status.json must contain activeSubtitleTracks")
    }
    if (status.videoId !== videoId) {
      throw new Error("status.json videoId must match its directory")
    }
    if (typeof status.state !== "string" || !JOB_STATE_SET.has(status.state)) {
      throw new Error("status.json contains an unsupported state")
    }
    if (typeof status.stage !== "string" || !JOB_STAGE_PATTERN.test(status.stage)) {
      throw new Error("status.json must contain a semantic stage token")
    }
    if (
      typeof status.progress !== "number" ||
      !Number.isFinite(status.progress) ||
      status.progress < 0 ||
      status.progress > 100
    ) {
      throw new Error("status.json progress must be between 0 and 100")
    }
    if (status.transcription !== null && status.transcription !== undefined) {
      const transcription = status.transcription as unknown as Record<string, unknown>
      if (
        typeof status.transcription !== "object" ||
        Array.isArray(status.transcription) ||
        Object.keys(transcription).some(
          (key) =>
            ![
              "provider",
              "model",
              "languageTag",
              "engineLanguage",
              "updatedAt",
            ].includes(key),
        ) ||
        !["local", "openai"].includes(String(transcription.provider)) ||
        typeof transcription.model !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(transcription.model) ||
        typeof transcription.languageTag !== "string" ||
        !LANGUAGE_PATTERN.test(transcription.languageTag) ||
        typeof transcription.updatedAt !== "string" ||
        (transcription.languageTag === "und"
          ? transcription.engineLanguage !== null
          : typeof transcription.engineLanguage !== "string" ||
            !/^[a-z]{2,3}$/.test(transcription.engineLanguage))
      ) {
        throw new Error("status.json contains invalid transcription metadata")
      }
    }
    if (status.subtitlePipeline !== null && status.subtitlePipeline !== undefined) {
      const pipeline = status.subtitlePipeline as Record<string, unknown>
      if (
        typeof status.subtitlePipeline !== "object" ||
        !["proofread", "translate"].includes(
          String((status.subtitlePipeline as Record<string, unknown>).mode),
        ) ||
        !SUBTITLE_PIPELINE_STAGE_SET.has(
          String((status.subtitlePipeline as Record<string, unknown>).stage),
        ) ||
        typeof pipeline.sourceLanguage !== "string" ||
        !LANGUAGE_PATTERN.test(pipeline.sourceLanguage) ||
        typeof pipeline.outputLanguage !== "string" ||
        !LANGUAGE_PATTERN.test(pipeline.outputLanguage) ||
        (pipeline.mode === "proofread" &&
          pipeline.sourceLanguage !== pipeline.outputLanguage) ||
        (pipeline.mode === "translate" &&
          pipeline.sourceLanguage === pipeline.outputLanguage) ||
        !Array.isArray(
          pipeline.manualReferenceArtifactIds,
        ) ||
        [
          "timingProvider",
          "timingModel",
          "contentProvider",
          "contentModel",
        ].some((key) => key in pipeline) ||
        (pipeline.timingProcessor !== undefined &&
          !validProcessorIdentity(pipeline.timingProcessor, true)) ||
        (pipeline.contentProcessor !== undefined &&
          !validProcessorIdentity(pipeline.contentProcessor)) ||
        (pipeline.segmentationProcessor !== undefined &&
          !validProcessorIdentity(pipeline.segmentationProcessor))
      ) {
        throw new Error("status.json contains an invalid subtitlePipeline")
      }
    }
    if (Array.isArray(status.history)) {
      for (const entry of status.history) {
        if (
          !entry ||
          typeof entry !== "object" ||
          (entry.state !== undefined && !JOB_STATE_SET.has(String(entry.state))) ||
          (entry.stage !== undefined && !JOB_STAGE_PATTERN.test(String(entry.stage)))
        ) {
          throw new Error("status.json contains an invalid history entry")
        }
      }
    }
    return {
      status: status as unknown as RawStatus,
      modifiedAt: statSync(statusPath).mtimeMs,
    }
  }

  private resolvedSubtitleCatalog(
    videoId: string,
    status?: RawStatus,
  ): ResolvedSubtitleCatalog {
    const resolvedStatus = status ?? this.loadRawStatus(videoId).status
    return resolveSubtitleCatalog({
      videoId,
      jobDirectory: this.jobDirectory(videoId),
      rawArtifacts: resolvedStatus.subtitleArtifacts,
      explicitActiveTracks: resolvedStatus.activeSubtitleTracks,
    })
  }

  subtitleCatalog(videoId: string): SubtitleCatalogResponse {
    return publicSubtitleCatalog(this.resolvedSubtitleCatalog(videoId))
  }

  setActiveSubtitleTrack(
    videoId: string,
    languageCode: string,
    trackId: string,
  ): SubtitleCatalogResponse {
    if (!LANGUAGE_PATTERN.test(languageCode)) {
      throw new Error("invalid subtitle language code")
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(trackId)) {
      throw new Error("invalid subtitle track ID")
    }
    const loaded = this.loadRawStatus(videoId)
    const catalog = this.resolvedSubtitleCatalog(videoId, loaded.status)
    if (!isSelectableSubtitleTrack(catalog, languageCode, trackId)) {
      throw new Error("subtitle track is unavailable for playback")
    }
    loaded.status.activeSubtitleTracks = {
      ...loaded.status.activeSubtitleTracks,
      [languageCode]: trackId,
    }
    atomicWriteJson(
      path.join(this.jobDirectory(videoId), "status.json"),
      loaded.status,
    )
    return this.subtitleCatalog(videoId)
  }

  artifactCaptionPaths(videoId: string, artifactId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(artifactId)) {
      throw new Error("invalid subtitle artifact ID")
    }
    const artifact = this.resolvedSubtitleCatalog(videoId).artifacts.find(
      (candidate) => candidate.id === artifactId,
    )
    if (!artifact) throw new Error("subtitle artifact not found")
    const roleLabels: Record<string, string> = {
      source_raw: "原始字幕",
      input_sentence: "輸入字幕",
      output_sentence: "輸出字幕",
      input_segmented: "來源時間軸",
      output_segmented: "切分字幕",
    }
    return artifact.tracks.map((track) => ({
      id: track.id,
      code: track.languageCode,
      label: `${track.languageCode} · ${roleLabels[track.role] ?? track.role}`,
      path: track.absolutePath,
    }))
  }

  activeCaptionPaths(videoId: string) {
    const catalog = this.resolvedSubtitleCatalog(videoId)
    return catalog.activeTracks.map((track) => ({
      id: track.id,
      code: track.languageCode,
      label: track.languageCode,
      path: track.absolutePath,
    }))
  }

  activeCaptionPath(videoId: string, languageCode: string) {
    if (!LANGUAGE_PATTERN.test(languageCode)) return null
    return (
      this.activeCaptionPaths(videoId).find(
        (track) => track.code === languageCode,
      )?.path ?? null
    )
  }

  summarize(videoId: string, includeHistory = false): JobSummary | JobDetail {
    const directory = this.jobDirectory(videoId)
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
      throw new Error("job not found")
    }

    let status: RawStatus
    let statusModifiedAt = 0
    try {
      const loaded = this.loadRawStatus(videoId)
      status = loaded.status
      statusModifiedAt = loaded.modifiedAt
    } catch (error) {
      status = {
        schemaVersion: STATUS_SCHEMA_VERSION,
        videoId,
        title: videoId,
        sourceUrl: "",
        state: "failed",
        stage: "status",
        progress: 0,
        message: "狀態檔無法讀取",
        updatedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
        history: [],
        subtitlePipeline: null,
        subtitleArtifacts: [],
        activeSubtitleTracks: {},
      }
    }

    const video = this.videoPath(videoId)
    let mediaCatalog: ReturnType<typeof publicMediaCatalog> | null = null
    try {
      mediaCatalog = publicMediaCatalog(directory, videoId)
    } catch {
      mediaCatalog = null
    }
    const activeRendition = mediaCatalog?.renditions.find(
      (rendition) => rendition.active,
    )
    const subtitleCatalog = this.resolvedSubtitleCatalog(videoId, status)
    const thumbnail = this.thumbnailPath(videoId)
    const state = status.state
    let effectiveState: JobState = state
    let message = String(status.message || "")

    if (ACTIVE_STATES.has(state)) {
      const updated = status.updatedAt ? Date.parse(status.updatedAt) : Number.NaN
      const stale = Number.isFinite(updated) ? Date.now() - updated > 45_000 : true
      if (!processIsAlive(status.process?.pid) && stale) {
        effectiveState = "interrupted"
        message = "工作程序已停止。可由 Agent 從目前階段繼續"
      }
    }

    if (state === "ready" && !video) {
      effectiveState = "failed"
      message = "狀態顯示完成，但找不到可播放的媒體 rendition"
    }

    const playback = this.playbackState(videoId)
    const statusDuration = finiteNumber(status.durationSeconds, Number.NaN)
    const durationSeconds =
      Number.isFinite(statusDuration) && statusDuration > 0
        ? statusDuration
        : playback.duration
    const summary: JobSummary = {
      videoId,
      title: status.title || videoId,
      sourceUrl: status.sourceUrl || "",
      state,
      effectiveState,
      stage: status.stage || state,
      progress: finiteNumber(status.progress),
      message,
      createdAt: status.createdAt ?? null,
      updatedAt: status.updatedAt ?? null,
      completedAt: status.completedAt ?? null,
      lastError: status.lastError ?? null,
      watchable: Boolean(video),
      captionCodes: subtitleCatalog.availableLanguageCodes,
      activeSubtitleKinds: Object.fromEntries(
        subtitleCatalog.activeTracks.map((track) => [
          track.languageCode,
          track.artifactKind,
        ]),
      ),
      activeSubtitleVersions: Object.fromEntries(
        subtitleCatalog.activeTracks.map((track) => [
          track.languageCode,
          `${track.artifactKind}:${track.revision}:${track.checksum}`,
        ]),
      ),
      subtitlePipeline: status.subtitlePipeline ?? null,
      transcription: status.transcription ?? null,
      sizeBytes: this.jobSize(directory),
      thumbnailUrl: thumbnail ? `/thumbnails/${videoId}` : null,
      watchUrl: video ? `/watch/${videoId}/?embed=1` : null,
      hasLog: isRegularFile(path.join(directory, "logs", "workflow.log")),
      durationSeconds,
      activeMedia:
        activeRendition
          ? {
              id: activeRendition.id,
              width: activeRendition.width,
              height: activeRendition.height,
              container: activeRendition.container,
              videoCodec: activeRendition.videoCodec,
              audioCodec: activeRendition.audioCodec,
              sizeBytes: activeRendition.sizeBytes,
              checksum: activeRendition.checksum,
            }
          : null,
      renditionCount: mediaCatalog?.renditions.length ?? 0,
      mediaRevision: mediaCatalog?.revision ?? 0,
      playback,
    }

    this.project(
      summary,
      status,
      subtitleCatalog,
      statusModifiedAt,
    )

    if (!includeHistory) return summary
    return {
      ...summary,
      history: Array.isArray(status.history)
        ? status.history.map((entry, sequence) => ({ ...entry, sequence }))
        : [],
      assets:
        status.assets && typeof status.assets === "object" ? status.assets : {},
    }
  }

  list() {
    const summaries: JobSummary[] = []
    for (const entry of readdirSync(this.jobsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !VIDEO_ID_PATTERN.test(entry.name)) {
        continue
      }
      summaries.push(this.summarize(entry.name, false) as JobSummary)
    }
    return summaries.sort((left, right) =>
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    )
  }

  tailLog(videoId: string, requestedLines = 160) {
    const logPath = this.safeJobFile(
      this.jobDirectory(videoId),
      path.join(this.jobDirectory(videoId), "logs", "workflow.log"),
    )
    if (!logPath) return ""
    const lines = readFileSync(logPath, "utf8").split(/\r?\n/)
    return lines.slice(-Math.max(20, Math.min(500, requestedLines))).join("\n")
  }

  playerConfig(videoId: string) {
    const summary = this.summarize(videoId) as JobSummary
    if (!summary.watchable) throw new Error("video not found")
    const catalog = this.resolvedSubtitleCatalog(videoId)
    const tracks = catalog.activeTracks.map((track) => ({
      code: track.languageCode,
      label: track.languageCode,
      src: `/captions/${videoId}/${track.languageCode}.vtt?revision=${track.checksum}`,
      artifactKind: track.artifactKind,
      revision: track.revision,
    }))
    const preferred = [
      summary.playback.captionLanguage,
      summary.subtitlePipeline?.outputLanguage,
      summary.subtitlePipeline?.sourceLanguage,
    ].find((code) => code && catalog.availableLanguageCodes.includes(code))
    const defaultLanguage = preferred ?? tracks[0]?.code ?? "off"
    return {
      videoId,
      title: summary.title,
      kicker: "Local library · iframe screening",
      video: {
        src: `/media/${videoId}/video?revision=${summary.mediaRevision}`,
        type: "video/mp4",
      },
      defaultLanguage,
      captions: tracks,
      playback: summary.playback,
    }
  }

  private project(
    summary: JobSummary,
    status: RawStatus,
    subtitleCatalog: ResolvedSubtitleCatalog,
    statusModifiedAt: number,
  ) {
    const projectedAt = new Date().toISOString()
    const databaseArtifactId = (artifactId: string) =>
      `${summary.videoId}:${artifactId}`
    const databaseTrackId = (trackId: string) => `${summary.videoId}:${trackId}`
    this.db.transaction((transaction) => {
      transaction
        .insert(jobs)
        .values({
          videoId: summary.videoId,
          title: summary.title,
          sourceUrl: summary.sourceUrl,
          state: summary.state,
          effectiveState: summary.effectiveState,
          stage: summary.stage,
          progress: summary.progress,
          message: summary.message,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
          completedAt: summary.completedAt,
          lastError: summary.lastError,
          watchable: summary.watchable,
          sizeBytes: summary.sizeBytes,
          thumbnailUrl: summary.thumbnailUrl,
          watchUrl: summary.watchUrl,
          hasLog: summary.hasLog,
          statusModifiedAt: Math.round(statusModifiedAt),
          projectedAt,
        })
        .onConflictDoUpdate({
          target: jobs.videoId,
          set: {
            title: summary.title,
            sourceUrl: summary.sourceUrl,
            state: summary.state,
            effectiveState: summary.effectiveState,
            stage: summary.stage,
            progress: summary.progress,
            message: summary.message,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            completedAt: summary.completedAt,
            lastError: summary.lastError,
            watchable: summary.watchable,
            sizeBytes: summary.sizeBytes,
            thumbnailUrl: summary.thumbnailUrl,
            watchUrl: summary.watchUrl,
            hasLog: summary.hasLog,
            statusModifiedAt: Math.round(statusModifiedAt),
            projectedAt,
          },
        })
        .run()

      transaction.delete(jobHistory).where(eq(jobHistory.videoId, summary.videoId)).run()
      const history = Array.isArray(status.history) ? status.history : []
      if (history.length > 0) {
        transaction
          .insert(jobHistory)
          .values(
            history.map((entry, sequence) => ({
              videoId: summary.videoId,
              sequence,
              at: entry.at,
              state: entry.state,
              stage: entry.stage,
              message: entry.message,
            })),
          )
          .run()
      }

      transaction.delete(jobAssets).where(eq(jobAssets.videoId, summary.videoId)).run()
      const assets = status.assets ?? {}
      const assetRows = Object.entries(assets).flatMap(([kind, raw]) => {
        if (!raw || typeof raw !== "object") return []
        const asset = raw as Record<string, unknown>
        if (typeof asset.path !== "string") return []
        return [
          {
            videoId: summary.videoId,
            kind,
            relativePath: asset.path,
            sizeBytes:
              typeof asset.bytes === "number" ? Math.round(asset.bytes) : null,
            updatedAt:
              typeof asset.updatedAt === "string" ? asset.updatedAt : null,
            available: Boolean(
              safeContainedFile(
                this.jobDirectory(summary.videoId),
                path.join(this.jobDirectory(summary.videoId), asset.path),
              ),
            ),
          },
        ]
      })
      if (assetRows.length > 0) transaction.insert(jobAssets).values(assetRows).run()

      transaction
        .delete(mediaDownloadRuns)
        .where(eq(mediaDownloadRuns.videoId, summary.videoId))
        .run()
      transaction
        .delete(mediaRenditions)
        .where(eq(mediaRenditions.videoId, summary.videoId))
        .run()
      let projectedMedia: ReturnType<typeof publicMediaCatalog> | null = null
      try {
        projectedMedia = publicMediaCatalog(
          this.jobDirectory(summary.videoId),
          summary.videoId,
        )
      } catch {
        projectedMedia = null
      }
      if (projectedMedia?.renditions.length) {
        const stored = readJsonFile<{
          renditions: Array<{ id: string; path: string }>
        }>(mediaCatalogPath(this.jobDirectory(summary.videoId)))
        const paths = new Map(
          stored.renditions.map((rendition) => [rendition.id, rendition.path]),
        )
        transaction
          .insert(mediaRenditions)
          .values(
            projectedMedia.renditions.map((rendition) => ({
              id: rendition.id,
              videoId: summary.videoId,
              requestedHeight: rendition.requestedHeight,
              width: rendition.width,
              height: rendition.height,
              container: rendition.container,
              videoCodec: rendition.videoCodec,
              audioCodec: rendition.audioCodec,
              relativePath: paths.get(rendition.id) ?? "",
              sizeBytes: rendition.sizeBytes,
              checksum: rendition.checksum,
              active: rendition.active,
              createdAt: rendition.createdAt,
            })),
          )
          .run()
      }
      if (projectedMedia?.operation) {
        transaction
          .insert(mediaDownloadRuns)
          .values({
            id: projectedMedia.operation.id,
            videoId: summary.videoId,
            requestedHeight: projectedMedia.operation.requestedHeight,
            state: projectedMedia.operation.state,
            stage: projectedMedia.operation.stage,
            progress: projectedMedia.operation.progress,
            message: projectedMedia.operation.message,
            error: projectedMedia.operation.error,
            startedAt: projectedMedia.operation.startedAt,
            updatedAt: projectedMedia.operation.updatedAt,
            completedAt: projectedMedia.operation.completedAt,
          })
          .run()
      }

      transaction
        .delete(activeSubtitleTracks)
        .where(eq(activeSubtitleTracks.videoId, summary.videoId))
        .run()
      transaction
        .delete(subtitleRuns)
        .where(eq(subtitleRuns.videoId, summary.videoId))
        .run()
      transaction
        .delete(subtitleArtifactTracks)
        .where(eq(subtitleArtifactTracks.videoId, summary.videoId))
        .run()
      transaction
        .delete(subtitleArtifacts)
        .where(eq(subtitleArtifacts.videoId, summary.videoId))
        .run()

      if (subtitleCatalog.artifacts.length > 0) {
        transaction
          .insert(subtitleArtifacts)
          .values(
            subtitleCatalog.artifacts.map((artifact) => ({
              id: databaseArtifactId(artifact.id),
              videoId: summary.videoId,
              kind: artifact.kind,
              revision: artifact.revision,
              lifecycleState: artifact.lifecycleState,
              validationState: artifact.validationState,
              freshnessState: artifact.freshnessState,
              sourceLanguage: artifact.sourceLanguage,
              outputLanguage: artifact.outputLanguage,
              sourceType: artifact.sourceType,
              processorProvider: artifact.processor.provider,
              processorService: artifact.processor.service ?? null,
              processorModel: artifact.processor.model ?? null,
              timingUnitKind: artifact.timingUnitKind,
              targetFrozen: artifact.targetFrozen,
              manifestPath: artifact.manifestPath
                ? path.relative(
                    this.jobDirectory(summary.videoId),
                    artifact.manifestPath,
                  )
                : null,
              checksum: artifact.checksum,
              warningCount: artifact.warningCount,
              hardDefectCount: artifact.hardDefectCount,
              createdAt: artifact.createdAt,
              completedAt: artifact.completedAt,
            })),
          )
          .run()

        const artifactTrackRows = subtitleCatalog.artifacts.flatMap((artifact) =>
          artifact.tracks.map((track) => ({
            id: databaseTrackId(track.id),
            artifactId: databaseArtifactId(artifact.id),
            videoId: summary.videoId,
            languageCode: track.languageCode,
            role: track.role,
            state: track.state,
            relativePath: track.relativePath,
            sizeBytes: track.sizeBytes,
            cueCount: track.cueCount,
            checksum: track.checksum,
            updatedAt: track.updatedAt,
          })),
        )
        if (artifactTrackRows.length > 0) {
          transaction.insert(subtitleArtifactTracks).values(artifactTrackRows).run()
        }

        const dependencyRows = subtitleCatalog.artifacts.flatMap((artifact) =>
          artifact.dependencies.map((dependency) => ({
              artifactId: databaseArtifactId(artifact.id),
              dependsOnArtifactId: databaseArtifactId(dependency.artifactId),
              relation: dependency.relation,
            })),
        )
        if (dependencyRows.length > 0) {
          transaction
            .insert(subtitleArtifactDependencies)
            .values(dependencyRows)
            .run()
        }

        if (subtitleCatalog.activeTracks.length > 0) {
          transaction
            .insert(activeSubtitleTracks)
            .values(
              subtitleCatalog.activeTracks.map((track) => ({
                videoId: summary.videoId,
                languageCode: track.languageCode,
                trackId: databaseTrackId(track.id),
                activatedAt: projectedAt,
                reason: track.reason,
              })),
            )
            .run()
        }
      }

      transaction
        .delete(subtitlePipelines)
        .where(eq(subtitlePipelines.videoId, summary.videoId))
        .run()
      if (summary.subtitlePipeline) {
        const pipeline = summary.subtitlePipeline
        transaction
          .insert(subtitlePipelines)
          .values({
            videoId: summary.videoId,
            mode: pipeline.mode,
            stage: pipeline.stage,
            sourceLanguage: pipeline.sourceLanguage,
            outputLanguage: pipeline.outputLanguage,
            timingProcessorProvider: pipeline.timingProcessor?.provider ?? null,
            timingProcessorService: pipeline.timingProcessor?.service ?? null,
            timingProcessorModel: pipeline.timingProcessor?.model ?? null,
            contentProcessorProvider: pipeline.contentProcessor?.provider ?? null,
            contentProcessorService: pipeline.contentProcessor?.service ?? null,
            contentProcessorModel: pipeline.contentProcessor?.model ?? null,
            segmentationProcessorProvider:
              pipeline.segmentationProcessor?.provider ?? null,
            segmentationProcessorService:
              pipeline.segmentationProcessor?.service ?? null,
            segmentationProcessorModel:
              pipeline.segmentationProcessor?.model ?? null,
            manualReferenceArtifactIds: pipeline.manualReferenceArtifactIds,
            updatedAt: pipeline.updatedAt,
          })
          .run()
        const pipelineStage = summary.subtitlePipeline.stage ?? summary.stage
        const runKind = /segment|alignment|frozen|validation/.test(pipelineStage)
          ? "segmentation"
          : /content/.test(pipelineStage)
            ? summary.subtitlePipeline.mode === "translate"
              ? "translation"
              : "proofread"
            : "source"
        const processor: ProcessorIdentity | undefined =
          runKind === "segmentation"
            ? pipeline.segmentationProcessor
            : runKind === "source"
              ? pipeline.timingProcessor
              : pipeline.contentProcessor
        transaction
          .insert(subtitleRuns)
          .values({
            id: `${summary.videoId}:current`,
            videoId: summary.videoId,
            kind: runKind,
            state:
              summary.effectiveState === "failed"
                ? "failed"
                : ACTIVE_STATES.has(summary.effectiveState)
                  ? "processing"
                  : "ready",
            stage: pipelineStage,
            processorProvider: processor?.provider ?? null,
            processorService: processor?.service ?? null,
            processorModel: processor?.model ?? null,
            startedAt: summary.createdAt,
            completedAt: summary.completedAt,
            error: summary.lastError,
          })
          .run()
      }

      transaction
        .insert(playbackStates)
        .values({ videoId: summary.videoId, ...summary.playback })
        .onConflictDoUpdate({
          target: playbackStates.videoId,
          set: summary.playback,
        })
        .run()
    })
  }
}
