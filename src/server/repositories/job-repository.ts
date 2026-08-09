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
  jobAssets,
  jobHistory,
  jobs,
  playbackStates,
  subtitleTracks,
  subtitleWorkflows,
} from "@server/db/schema"
import {
  atomicWriteJson,
  isRegularFile,
  readJsonFile,
  safeContainedFile,
} from "@server/lib/files"
import type {
  JobDetail,
  JobHistoryEntry,
  JobSummary,
  PlaybackState,
  SubtitleTrackState,
  SubtitleWorkflow,
  TranscriptionSummary,
} from "@shared/contracts/job"
import { parseWebVtt } from "@shared/domain/subtitle"

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const LANGUAGE_PATTERN = /^[A-Za-z0-9_-]+$/
const ACTIVE_STATES = new Set([
  "checking",
  "downloading",
  "transcribing",
  "translating",
  "preparing_player",
])

interface RawStatus {
  videoId?: string
  title?: string
  sourceUrl?: string
  state?: string
  stage?: string
  progress?: number
  message?: string
  createdAt?: string | null
  updatedAt?: string | null
  completedAt?: string | null
  lastError?: string | null
  process?: { pid?: number } | null
  assets?: Record<string, unknown>
  subtitleTracks?: Record<string, SubtitleTrackState>
  subtitleWorkflow?: SubtitleWorkflow | null
  transcription?: TranscriptionSummary | null
  durationSeconds?: number | null
  history?: JobHistoryEntry[]
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
    return this.safeJobFile(directory, path.join(directory, "source", "video.mp4"))
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

  captionPaths(videoId: string) {
    const directory = this.jobDirectory(videoId)
    const captionsDirectory = path.join(directory, "captions")
    if (!existsSync(captionsDirectory) || lstatSync(captionsDirectory).isSymbolicLink()) {
      return new Map<string, string>()
    }
    const tracks = new Map<string, string>()
    for (const entry of readdirSync(captionsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || path.extname(entry.name) !== ".vtt") {
        continue
      }
      const code = path.basename(entry.name, ".vtt")
      if (!LANGUAGE_PATTERN.test(code)) continue
      const candidate = this.safeJobFile(
        directory,
        path.join(captionsDirectory, entry.name),
      )
      if (candidate) tracks.set(code, candidate)
    }
    return new Map([...tracks].sort(([left], [right]) => left.localeCompare(right)))
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
      return { time: 0, duration: null, updatedAt: null }
    }
    try {
      const payload = readJsonFile<Record<string, unknown>>(statePath)
      const time = finiteNumber(payload.time)
      const duration = finiteNumber(payload.duration, Number.NaN)
      return {
        time: time >= 0 ? time : 0,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      }
    } catch {
      return { time: 0, duration: null, updatedAt: null }
    }
  }

  savePlaybackState(
    videoId: string,
    payload: { time: number; duration?: number | null },
  ) {
    const directory = this.jobDirectory(videoId)
    if (!existsSync(directory)) throw new Error("job not found")
    // Ensure the filesystem fact source is projected before the foreign-keyed UI state.
    this.summarize(videoId)
    const time = payload.time
    const duration = payload.duration ?? null
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
    return {
      status: readJsonFile<RawStatus>(statusPath),
      modifiedAt: statSync(statusPath).mtimeMs,
    }
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
        subtitleTracks: {},
        subtitleWorkflow: null,
      }
    }

    const video = this.videoPath(videoId)
    const captions = this.captionPaths(videoId)
    const thumbnail = this.thumbnailPath(videoId)
    const state = String(status.state || "queued")
    let effectiveState = state
    let message = String(status.message || "")

    if (status.videoId && status.videoId !== videoId) {
      effectiveState = "failed"
      message = "status.json 的 videoId 與資料夾名稱不一致"
      status.lastError = `expected ${videoId}, got ${status.videoId}`
    } else if (ACTIVE_STATES.has(state)) {
      const updated = status.updatedAt ? Date.parse(status.updatedAt) : Number.NaN
      const stale = Number.isFinite(updated) ? Date.now() - updated > 45_000 : true
      if (!processIsAlive(status.process?.pid) && stale) {
        effectiveState = "interrupted"
        message = "工作程序已停止。可由 Agent 從目前階段繼續"
      }
    }

    if (state === "ready" && !video) {
      effectiveState = "failed"
      message = "狀態顯示完成，但找不到 video.mp4"
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
      captionCodes: [...captions.keys()],
      subtitleTracks: status.subtitleTracks ?? {},
      subtitleWorkflow: status.subtitleWorkflow ?? null,
      transcription: status.transcription ?? null,
      sizeBytes: this.jobSize(directory),
      thumbnailUrl: thumbnail ? `/thumbnails/${videoId}` : null,
      watchUrl: video ? `/watch/${videoId}/?embed=1` : null,
      hasLog: isRegularFile(path.join(directory, "logs", "workflow.log")),
      durationSeconds,
      playback,
    }

    this.project(summary, status, captions, statusModifiedAt)

    if (!includeHistory) return summary
    return {
      ...summary,
      history: Array.isArray(status.history) ? status.history : [],
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
    const captions = this.captionPaths(videoId)
    const labels: Record<string, string> = {
      "zh-TW": "繁體中文",
      "zh-Hant": "繁體中文",
      en: "English",
      ja: "日本語",
      ko: "한국어",
      source: "原文",
    }
    const tracks = [...captions.keys()].map((code) => ({
      code,
      label: labels[code] ?? code,
      src: `/captions/${videoId}/${code}.vtt`,
    }))
    const defaultLanguage = captions.has("zh-TW")
      ? "zh-TW"
      : captions.has("en")
        ? "en"
        : tracks[0]?.code ?? "off"
    return {
      videoId,
      title: summary.title,
      kicker: "Local library · iframe screening",
      video: { src: `/media/${videoId}/video`, type: "video/mp4" },
      defaultLanguage,
      captions: tracks,
      playback: summary.playback,
    }
  }

  private project(
    summary: JobSummary,
    status: RawStatus,
    captionFiles: Map<string, string>,
    statusModifiedAt: number,
  ) {
    const projectedAt = new Date().toISOString()
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
        .delete(subtitleTracks)
        .where(eq(subtitleTracks.videoId, summary.videoId))
        .run()
      const trackRows = summary.captionCodes.map((languageCode) => {
        const metadata = summary.subtitleTracks[languageCode] ?? {}
        const captionPath = captionFiles.get(languageCode)
        let cueCount = 0
        if (captionPath) {
          try {
            cueCount = parseWebVtt(readFileSync(captionPath, "utf8")).length
          } catch {
            cueCount = 0
          }
        }
        return {
          videoId: summary.videoId,
          languageCode,
          state: metadata.state ?? null,
          source: metadata.source ?? null,
          label: metadata.label ?? languageCode,
          relativePath: metadata.path ?? `captions/${languageCode}.vtt`,
          sizeBytes:
            typeof metadata.bytes === "number"
              ? Math.round(metadata.bytes)
              : captionPath
                ? statSync(captionPath).size
                : null,
          cueCount,
          updatedAt: metadata.updatedAt ?? null,
        }
      })
      if (trackRows.length > 0) transaction.insert(subtitleTracks).values(trackRows).run()

      transaction
        .delete(subtitleWorkflows)
        .where(eq(subtitleWorkflows.videoId, summary.videoId))
        .run()
      if (summary.subtitleWorkflow) {
        transaction
          .insert(subtitleWorkflows)
          .values({ videoId: summary.videoId, ...summary.subtitleWorkflow })
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
