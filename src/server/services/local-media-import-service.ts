import { createHash } from "node:crypto"
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { once } from "node:events"
import path from "node:path"

import { asc, desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  localMediaImports,
  operationEvents,
  operations,
} from "@server/db/schema"
import { atomicWriteJson } from "@server/lib/files"
import type { JobRepository } from "@server/repositories/job-repository"
import type {
  CreateLocalMediaImportRequest,
  CreateLocalMediaImportResponse,
  ImportLibraryItem,
  LocalMediaImportState,
} from "@shared/contracts/library"

const MAX_IMPORT_BYTES = 16 * 1024 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm"])
const ACTIVE_STATES = new Set<LocalMediaImportState>([
  "uploading",
  "probing",
  "transcoding",
  "finalizing",
])

function now() {
  return new Date().toISOString()
}

function normalizeTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ")
  if (!normalized || normalized.length > 200) {
    throw new LocalMediaImportError(
      "影音標題需為 1 到 200 個字元",
      "invalid-import-title",
      400,
    )
  }
  return normalized
}

function normalizeFileName(value: string) {
  const normalized = path.basename(value.trim())
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized !== value.trim() ||
    !ALLOWED_EXTENSIONS.has(path.extname(normalized).toLowerCase())
  ) {
    throw new LocalMediaImportError(
      "只接受 MP4、M4V、MOV、MKV 或 WebM 影音",
      "unsupported-import-file",
      400,
    )
  }
  return normalized
}

function parseProbe(stderr: string) {
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const video = stderr.match(/Stream[^\n]*Video:\s*([^,\s]+)[^\n]*?(\d{2,6})x(\d{2,6})/)
  const audio = stderr.match(/Stream[^\n]*Audio:\s*([^,\s]+)/)
  if (!duration || !video) {
    throw new LocalMediaImportError(
      "檔案中找不到可匯入的影音軌",
      "invalid-media-file",
      400,
    )
  }
  const durationSeconds =
    Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
  const width = Number(video[2])
  const height = Number(video[3])
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new LocalMediaImportError(
      "影音資訊無效",
      "invalid-media-file",
      400,
    )
  }
  return {
    durationSeconds,
    width,
    height,
    videoCodec: video[1].toLowerCase(),
    audioCodec: audio?.[1]?.toLowerCase() ?? null,
  }
}

async function checksumFile(candidate: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(candidate)) hash.update(chunk)
  return hash.digest("hex")
}

export class LocalMediaImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class LocalMediaImportService {
  private readonly temporaryRoot: string

  constructor(
    private readonly workspace: string,
    private readonly db: AppDatabase,
    private readonly jobs: JobRepository,
    private readonly ffmpegOverride: string | null = null,
  ) {
    this.temporaryRoot = path.join(
      path.resolve(workspace),
      ".agent-tools",
      "insu-player",
      "tmp",
      "imports",
    )
    mkdirSync(this.temporaryRoot, { recursive: true, mode: 0o700 })
  }

  create(payload: CreateLocalMediaImportRequest): CreateLocalMediaImportResponse {
    if (!payload.rightsConfirmed) {
      throw new LocalMediaImportError(
        "匯入前請先確認你有權處理這個影音",
        "rights-not-confirmed",
        400,
      )
    }
    const originalName = normalizeFileName(payload.originalName)
    const title = normalizeTitle(payload.title)
    if (
      !Number.isSafeInteger(payload.sizeBytes) ||
      payload.sizeBytes <= 0 ||
      payload.sizeBytes > MAX_IMPORT_BYTES
    ) {
      throw new LocalMediaImportError(
        "影音大小必須介於 1 byte 與 16 GB",
        "invalid-import-size",
        400,
      )
    }
    const contentType = payload.contentType.trim().slice(0, 200) || "application/octet-stream"
    const importId = `local-import-${crypto.randomUUID()}`
    const operationId = `media-import-${crypto.randomUUID()}`
    const timestamp = now()
    this.db.transaction((transaction) => {
      transaction
        .insert(operations)
        .values({
          id: operationId,
          videoId: null,
          parentOperationId: null,
          kind: "media-import",
          state: "awaiting_upload",
          stage: "awaiting-upload",
          progress: 0,
          message: "等待上傳本機影音",
          inputsJson: { originalName, sizeBytes: payload.sizeBytes, contentType },
          outputsJson: {},
          consentJson: { rightsConfirmed: true },
          resumable: false,
          attempt: 1,
          pid: null,
          errorCode: null,
          errorMessage: null,
          createdAt: timestamp,
          startedAt: null,
          updatedAt: timestamp,
          completedAt: null,
        })
        .run()
      transaction
        .insert(operationEvents)
        .values({
          operationId,
          sequence: 1,
          type: "created",
          state: "awaiting_upload",
          stage: "awaiting-upload",
          progress: 0,
          message: "等待上傳本機影音",
          dataJson: {},
          createdAt: timestamp,
        })
        .run()
      transaction
        .insert(localMediaImports)
        .values({
          id: importId,
          operationId,
          videoId: null,
          originalName,
          title,
          contentType,
          sizeBytes: payload.sizeBytes,
          uploadedBytes: 0,
          checksum: null,
          rightsConfirmed: true,
          createdAt: timestamp,
          completedAt: null,
        })
        .run()
    })
    return {
      importId,
      uploadUrl: `/api/library/imports/${encodeURIComponent(importId)}/content`,
    }
  }

  list(): ImportLibraryItem[] {
    return this.db
      .select({ import: localMediaImports, operation: operations })
      .from(localMediaImports)
      .innerJoin(operations, eq(localMediaImports.operationId, operations.id))
      .orderBy(asc(localMediaImports.createdAt))
      .all()
      .map(({ import: item, operation }) => ({
        kind: "import",
        id: item.id,
        originalName: item.originalName,
        title: item.title,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        uploadedBytes: item.uploadedBytes,
        videoId: item.videoId,
        state: operation.state as LocalMediaImportState,
        stage: operation.stage,
        progress: operation.progress,
        message: operation.message,
        errorCode: operation.errorCode,
        createdAt: item.createdAt,
        updatedAt: operation.updatedAt,
        completedAt: item.completedAt,
      }))
  }

  private item(importId: string) {
    const item = this.db
      .select()
      .from(localMediaImports)
      .where(eq(localMediaImports.id, importId))
      .get()
    if (!item) {
      throw new LocalMediaImportError(
        "找不到本機匯入工作",
        "local-import-not-found",
        404,
      )
    }
    return item
  }

  private updateOperation(
    operationId: string,
    values: Partial<typeof operations.$inferInsert>,
  ) {
    const timestamp = now()
    const current = this.db
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .get()
    if (!current) throw new Error("local import operation is unavailable")
    const next = { ...current, ...values, updatedAt: timestamp }
    const last = this.db
      .select({ sequence: operationEvents.sequence })
      .from(operationEvents)
      .where(eq(operationEvents.operationId, operationId))
      .orderBy(desc(operationEvents.sequence))
      .limit(1)
      .get()
    this.db.transaction((transaction) => {
      transaction
        .update(operations)
        .set({ ...values, updatedAt: timestamp })
        .where(eq(operations.id, operationId))
        .run()
      transaction
        .insert(operationEvents)
        .values({
          operationId,
          sequence: (last?.sequence ?? 0) + 1,
          type: "progress",
          state: String(next.state),
          stage: String(next.stage),
          progress: Number(next.progress),
          message: String(next.message),
          dataJson: {},
          createdAt: timestamp,
        })
        .run()
    })
  }

  private ffmpegPath() {
    const candidate = this.ffmpegOverride ?? path.join(
      this.workspace,
      ".agent-tools",
      "insu-player",
      "bin",
      "ffmpeg",
    )
    if (
      !existsSync(candidate) ||
      lstatSync(candidate).isSymbolicLink() ||
      !lstatSync(candidate).isFile()
    ) {
      throw new LocalMediaImportError(
        "FFmpeg 尚未準備完成",
        "ffmpeg-unavailable",
        409,
      )
    }
    return candidate
  }

  private async runFfmpeg(args: string[]) {
    const child = Bun.spawn([this.ffmpegPath(), ...args], {
      cwd: this.workspace,
      stdout: "ignore",
      stderr: "pipe",
    })
    const stderr = await new Response(child.stderr).text()
    const exitCode = await child.exited
    return { exitCode, stderr }
  }

  async upload(importId: string, request: Request) {
    const item = this.item(importId)
    const operation = this.db
      .select()
      .from(operations)
      .where(eq(operations.id, item.operationId))
      .get()
    if (!operation || operation.state !== "awaiting_upload") {
      throw new LocalMediaImportError(
        "這個匯入工作已經開始或結束",
        "local-import-not-uploadable",
        409,
      )
    }
    const contentLength = Number(request.headers.get("content-length"))
    if (contentLength !== item.sizeBytes || !request.body) {
      throw new LocalMediaImportError(
        "上傳內容大小與選取的檔案不一致",
        "local-import-size-mismatch",
        400,
      )
    }

    const importRoot = path.join(this.temporaryRoot, importId)
    const uploadPath = path.join(importRoot, `upload${path.extname(item.originalName).toLowerCase()}`)
    mkdirSync(importRoot, { recursive: true, mode: 0o700 })
    const output = createWriteStream(uploadPath, { flags: "wx", mode: 0o600 })
    const reader = request.body.getReader()
    const hash = createHash("sha256")
    let received = 0
    let reported = -1
    this.updateOperation(item.operationId, {
      state: "uploading",
      stage: "uploading",
      progress: 0,
      message: "正在匯入本機影音",
      startedAt: now(),
    })
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > item.sizeBytes) {
          throw new LocalMediaImportError(
            "上傳內容超出預期大小",
            "local-import-size-mismatch",
            400,
          )
        }
        hash.update(chunk.value)
        if (!output.write(Buffer.from(chunk.value))) await once(output, "drain")
        const percentage = Math.min(70, Math.floor((received / item.sizeBytes) * 70))
        if (percentage >= reported + 2 || received === item.sizeBytes) {
          reported = percentage
          this.db
            .update(localMediaImports)
            .set({ uploadedBytes: received })
            .where(eq(localMediaImports.id, item.id))
            .run()
          this.updateOperation(item.operationId, {
            state: "uploading",
            stage: "uploading",
            progress: percentage,
            message: `正在匯入本機影音 ${Math.round((received / item.sizeBytes) * 100)}%`,
          })
        }
      }
      output.end()
      await once(output, "finish")
      if (received !== item.sizeBytes) {
        throw new LocalMediaImportError(
          "上傳內容不完整",
          "local-import-size-mismatch",
          400,
        )
      }
      chmodSync(uploadPath, 0o600)
      const sourceChecksum = hash.digest("hex")
      this.db
        .update(localMediaImports)
        .set({ uploadedBytes: received, checksum: sourceChecksum })
        .where(eq(localMediaImports.id, item.id))
        .run()
      return await this.process(item, uploadPath, sourceChecksum)
    } catch (error) {
      output.destroy()
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof LocalMediaImportError
        ? error.code
        : "local-import-failed"
      this.updateOperation(item.operationId, {
        state: "failed",
        stage: "failed",
        progress: 0,
        message: "本機影音匯入失敗",
        errorCode: code,
        errorMessage: message,
        pid: null,
        completedAt: now(),
      })
      this.db
        .update(localMediaImports)
        .set({ completedAt: now() })
        .where(eq(localMediaImports.id, item.id))
        .run()
      rmSync(importRoot, { recursive: true, force: true })
      throw error
    }
  }

  private async process(
    item: typeof localMediaImports.$inferSelect,
    uploadPath: string,
    sourceChecksum: string,
  ) {
    this.updateOperation(item.operationId, {
      state: "probing",
      stage: "probing",
      progress: 74,
      message: "正在檢查影音格式",
    })
    const probe = await this.runFfmpeg(["-hide_banner", "-i", uploadPath])
    const metadata = parseProbe(probe.stderr)
    const videoId = `local-${sourceChecksum.slice(0, 16)}`
    const existing = this.db
      .select({ videoId: localMediaImports.videoId })
      .from(localMediaImports)
      .where(eq(localMediaImports.checksum, sourceChecksum))
      .all()
      .find((candidate) => candidate.videoId)
    if (existing?.videoId || existsSync(this.jobs.jobDirectory(videoId))) {
      throw new LocalMediaImportError(
        "這個本機影音已經在影片中心",
        "local-import-duplicate",
        409,
      )
    }

    const importRoot = path.dirname(uploadPath)
    const stagingJob = path.join(importRoot, "job")
    const renditionRoot = path.join(stagingJob, "source", "renditions")
    const mediaWork = path.join(stagingJob, "media-work")
    mkdirSync(renditionRoot, { recursive: true, mode: 0o700 })
    mkdirSync(mediaWork, { recursive: true, mode: 0o700 })
    const renditionPath = path.join(renditionRoot, "imported.mp4")
    const extension = path.extname(item.originalName).toLowerCase()
    const directCopy =
      [".mp4", ".m4v"].includes(extension) &&
      ["h264", "avc1"].includes(metadata.videoCodec) &&
      (!metadata.audioCodec || metadata.audioCodec === "aac")

    if (directCopy) {
      renameSync(uploadPath, renditionPath)
    } else {
      this.updateOperation(item.operationId, {
        state: "transcoding",
        stage: "transcoding",
        progress: 80,
        message: "正在轉換成瀏覽器可播放格式",
      })
      const converted = await this.runFfmpeg([
        "-hide_banner",
        "-y",
        "-i",
        uploadPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        renditionPath,
      ])
      if (converted.exitCode !== 0 || !existsSync(renditionPath)) {
        throw new LocalMediaImportError(
          "影音格式轉換失敗",
          "local-import-transcode-failed",
          500,
        )
      }
    }

    this.updateOperation(item.operationId, {
      state: "finalizing",
      stage: "finalizing",
      progress: 94,
      message: "正在建立縮圖與媒體索引",
    })
    const normalizedProbe = await this.runFfmpeg(["-hide_banner", "-i", renditionPath])
    const normalized = parseProbe(normalizedProbe.stderr)
    const thumbnailPath = path.join(stagingJob, "source", "thumbnail.jpg")
    const thumbnail = await this.runFfmpeg([
      "-hide_banner",
      "-y",
      "-ss",
      String(Math.min(1, normalized.durationSeconds / 2)),
      "-i",
      renditionPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      thumbnailPath,
    ])
    if (thumbnail.exitCode !== 0) rmSync(thumbnailPath, { force: true })

    const renditionChecksum = await checksumFile(renditionPath)
    const renditionSize = statSync(renditionPath).size
    const timestamp = now()
    atomicWriteJson(path.join(mediaWork, "catalog.json"), {
      schemaVersion: 1,
      videoId,
      revision: 1,
      activeRenditionId: "imported",
      availability: { discoveredAt: timestamp, formats: [] },
      renditions: [
        {
          id: "imported",
          requestedHeight: normalized.height,
          width: normalized.width,
          height: normalized.height,
          container: "mp4",
          videoCodec: normalized.videoCodec,
          audioCodec: normalized.audioCodec,
          path: "source/renditions/imported.mp4",
          sizeBytes: renditionSize,
          checksum: renditionChecksum,
          createdAt: timestamp,
          formatId: null,
          selection: null,
        },
      ],
      operation: null,
    })
    const finalJob = this.jobs.jobDirectory(videoId)
    renameSync(stagingJob, finalJob)
    const assets: Record<string, { path: string; bytes: number; updatedAt: string }> = {
      media: {
        path: "source/renditions/imported.mp4",
        bytes: renditionSize,
        updatedAt: timestamp,
      },
    }
    if (existsSync(path.join(finalJob, "source", "thumbnail.jpg"))) {
      assets.thumbnail = {
        path: "source/thumbnail.jpg",
        bytes: statSync(path.join(finalJob, "source", "thumbnail.jpg")).size,
        updatedAt: timestamp,
      }
    }
    try {
      this.jobs.registerLocalMedia({
        videoId,
        title: item.title,
        durationSeconds: normalized.durationSeconds,
        createdAt: timestamp,
        assets,
      })
    } catch (error) {
      rmSync(finalJob, { recursive: true, force: true })
      throw error
    }
    this.db.transaction((transaction) => {
      transaction
        .update(localMediaImports)
        .set({ videoId, completedAt: timestamp })
        .where(eq(localMediaImports.id, item.id))
        .run()
      transaction
        .update(operations)
        .set({
          videoId,
          state: "ready",
          stage: "complete",
          progress: 100,
          message: "本機影音已加入影片中心",
          outputsJson: { videoId },
          errorCode: null,
          errorMessage: null,
          pid: null,
          updatedAt: timestamp,
          completedAt: timestamp,
        })
        .where(eq(operations.id, item.operationId))
        .run()
    })
    rmSync(importRoot, { recursive: true, force: true })
    return { accepted: true, importId: item.id, videoId }
  }

  remove(importId: string) {
    const item = this.item(importId)
    const operation = this.db
      .select()
      .from(operations)
      .where(eq(operations.id, item.operationId))
      .get()
    if (!operation || ACTIVE_STATES.has(operation.state as LocalMediaImportState)) {
      throw new LocalMediaImportError(
        "正在進行的匯入不能刪除",
        "local-import-active",
        409,
      )
    }
    if (operation.state === "ready") {
      throw new LocalMediaImportError(
        "已完成影音請從影片卡片刪除",
        "local-import-published",
        409,
      )
    }
    this.db.delete(operations).where(eq(operations.id, item.operationId)).run()
    rmSync(path.join(this.temporaryRoot, item.id), { recursive: true, force: true })
    return { removed: true }
  }
}
