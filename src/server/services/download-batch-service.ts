import { existsSync, lstatSync } from "node:fs"

import { asc, desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  downloadBatches,
  downloadBatchItems,
  operationEvents,
  operations,
} from "@server/db/schema"
import type { JobRepository } from "@server/repositories/job-repository"
import {
  MediaSessionOperationError,
  type ClaimedMediaSession,
  type MediaSessionService,
} from "@server/services/media-session-service"
import type {
  CreateDownloadBatchResponse,
  DownloadBatch,
  DownloadBatchItem,
  DownloadBatchListResponse,
  DownloadSourceInput,
} from "@shared/contracts/download-batch"

const MAX_BATCH_SIZE = 50
const ACTIVE_ITEM_STATES = new Set([
  "checking",
  "queued",
  "downloading",
  "verifying",
  "needs_confirmation",
])
function now() {
  return new Date().toISOString()
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

function normalizeWebUrl(value: string, label: string, maxLength = 8_192) {
  if (!value || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new DownloadBatchOperationError(`${label}無效`, "invalid-url", 400)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new DownloadBatchOperationError(
      `${label}必須是完整的 http 或 https 網址`,
      "invalid-url",
      400,
    )
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  ) {
    throw new DownloadBatchOperationError(`${label}無效`, "invalid-url", 400)
  }
  if (url.searchParams.has("list") || /(?:^|\/)playlist(?:\/|$)/i.test(url.pathname)) {
    throw new DownloadBatchOperationError(
      "不接受播放清單網址",
      "playlist-not-allowed",
      400,
    )
  }
  url.hash = ""
  return url.toString()
}

interface NormalizedSource {
  kind: DownloadSourceInput["kind"]
  pageUrl: string
  sourceKey: string
  sessionId: string | null
  candidateFingerprint: string | null
  authentication: "none" | "browser-session"
  authenticationConsentAt: string | null
}

export class DownloadBatchOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class DownloadBatchService {
  private readonly active = new Map<
    string,
    { child: ReturnType<typeof Bun.spawn>; dispose: () => void }
  >()
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly workspace: string,
    private readonly db: AppDatabase,
    private readonly jobs: JobRepository,
    private readonly downloadScript: string,
    private readonly mediaSessions: MediaSessionService,
    private readonly concurrency = 2,
  ) {}

  private script() {
    if (
      !existsSync(this.downloadScript) ||
      lstatSync(this.downloadScript).isSymbolicLink() ||
      !lstatSync(this.downloadScript).isFile()
    ) {
      throw new DownloadBatchOperationError(
        "影音下載程式無法使用",
        "runtime-unavailable",
        500,
      )
    }
    return this.downloadScript
  }

  create(
    sources: DownloadSourceInput[],
    rightsConfirmed: boolean,
  ): CreateDownloadBatchResponse {
    if (!rightsConfirmed) {
      throw new DownloadBatchOperationError(
        "開始下載前請先確認內容權利",
        "rights-not-confirmed",
        400,
      )
    }
    if (
      !Array.isArray(sources) ||
      sources.length === 0 ||
      sources.length > MAX_BATCH_SIZE
    ) {
      throw new DownloadBatchOperationError(
        `每批請加入 1 到 ${MAX_BATCH_SIZE} 個影音來源`,
        "invalid-batch-size",
        400,
      )
    }
    const normalized = sources.map((source) => this.normalizeSource(source))
    if (new Set(normalized.map((source) => source.sourceKey)).size !== normalized.length) {
      throw new DownloadBatchOperationError(
        "同一批次不能包含重複來源",
        "duplicate-source",
        400,
      )
    }
    const existing = new Map(
      this.jobs
        .list()
        .filter((job) => job.watchable)
        .map((job) => [job.sourceUrl, job]),
    )
    const batchId = `batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const timestamp = now()
    this.db.transaction((transaction) => {
      transaction
        .insert(downloadBatches)
        .values({
          id: batchId,
          state: "active",
          rightsConfirmed: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run()
      normalized.forEach((source, ordinal) => {
        const job = existing.get(source.pageUrl)
        const operationId = `download-${crypto.randomUUID()}`
        const state = job ? "downloaded" : "queued"
        const message = job ? "影音已存在於影音庫" : "等待下載"
        transaction
          .insert(operations)
          .values({
            id: operationId,
            videoId: job?.videoId ?? null,
            parentOperationId: null,
            kind: "media-download",
            state,
            stage: job ? "complete" : "awaiting-download",
            progress: job ? 100 : 0,
            message,
            inputsJson: {
              sourceKind: source.kind,
              pageUrl: source.pageUrl,
              candidateFingerprint: source.candidateFingerprint,
              sessionRequired: Boolean(source.sessionId),
            },
            outputsJson: job ? { videoId: job.videoId } : {},
            consentJson: {
              rightsConfirmed: true,
              authentication: source.authentication,
              authenticationConsentAt: source.authenticationConsentAt,
            },
            resumable: !source.sessionId,
            attempt: 1,
            pid: null,
            errorCode: null,
            errorMessage: null,
            createdAt: timestamp,
            startedAt: null,
            updatedAt: timestamp,
            completedAt: job ? timestamp : null,
          })
          .run()
        transaction
          .insert(operationEvents)
          .values({
            operationId,
            sequence: 1,
            type: "created",
            state,
            stage: job ? "complete" : "awaiting-download",
            progress: job ? 100 : 0,
            message,
            dataJson: {},
            createdAt: timestamp,
          })
          .run()
        transaction
          .insert(downloadBatchItems)
          .values({
            id: `${batchId}-${ordinal + 1}`,
            batchId,
            ordinal,
            sourceKind: source.kind,
            pageUrl: source.pageUrl,
            sourceUrl: source.pageUrl,
            sourceKey: source.sourceKey,
            sessionId: source.sessionId,
            operationId,
            videoId: job?.videoId ?? null,
            lowQualityApproved: false,
            authentication: source.authentication,
            authenticationConsentAt: source.authenticationConsentAt,
            createdAt: timestamp,
            completedAt: job ? timestamp : null,
          })
          .run()
      })
    })
    this.schedule()
    return { accepted: true, batch: this.batch(batchId) }
  }

  list(): DownloadBatchListResponse {
    this.synchronize()
    return {
      batches: this.db
        .select()
        .from(downloadBatches)
        .orderBy(desc(downloadBatches.createdAt))
        .all()
        .map((batch) => this.publicBatch(batch)),
    }
  }

  batch(batchId: string) {
    this.synchronize()
    const row = this.db
      .select()
      .from(downloadBatches)
      .where(eq(downloadBatches.id, batchId))
      .get()
    if (!row) {
      throw new DownloadBatchOperationError(
        "下載批次不存在",
        "batch-not-found",
        404,
      )
    }
    return this.publicBatch(row)
  }

  private publicBatch(row: typeof downloadBatches.$inferSelect): DownloadBatch {
    if (!row.rightsConfirmed) {
      throw new DownloadBatchOperationError(
        "下載批次缺少內容權利確認",
        "rights-not-confirmed",
        409,
      )
    }
    const items = this.db
      .select()
      .from(downloadBatchItems)
      .where(eq(downloadBatchItems.batchId, row.id))
      .orderBy(asc(downloadBatchItems.ordinal))
      .all()
      .map((item) => this.publicItem(item))
    return {
      id: row.id,
      state: row.state as DownloadBatch["state"],
      rightsConfirmed: true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items,
    }
  }

  private publicItem(
    item: typeof downloadBatchItems.$inferSelect,
  ): DownloadBatchItem {
    const operation = this.operation(item.operationId)
    return {
      id: item.id,
      ordinal: item.ordinal,
      sourceKind: item.sourceKind as DownloadBatchItem["sourceKind"],
      pageUrl: item.pageUrl,
      sourceUrl: item.sourceUrl,
      operationId: item.operationId,
      videoId: item.videoId,
      state: operation.state as DownloadBatchItem["state"],
      progress: operation.progress,
      message: operation.message,
      errorCode: operation.errorCode,
      lowQualityApproved: item.lowQualityApproved,
      authentication: item.authentication as DownloadBatchItem["authentication"],
      authenticationConsentAt: item.authenticationConsentAt,
      createdAt: item.createdAt,
      updatedAt: operation.updatedAt,
      completedAt: item.completedAt,
    }
  }

  private normalizeSource(source: DownloadSourceInput): NormalizedSource {
    if (!source || !["page", "embed", "network-media"].includes(source.kind)) {
      throw new DownloadBatchOperationError(
        "影音來源類型無效",
        "invalid-source",
        400,
      )
    }
    const pageUrl = normalizeWebUrl(source.pageUrl, "頁面網址", 2_048)
    if (source.kind !== "page" && !source.sessionId) {
      throw new DownloadBatchOperationError(
        "嵌入或網路媒體需要短期工作階段",
        "media-session-required",
        400,
      )
    }
    if (
      source.candidateFingerprint &&
      !/^[0-9a-f]{64}$/.test(source.candidateFingerprint)
    ) {
      throw new DownloadBatchOperationError(
        "媒體候選識別碼無效",
        "invalid-source",
        400,
      )
    }
    const session = source.sessionId
      ? this.mediaSessions.describe(source.sessionId)
      : {
          authentication: "none" as const,
          authenticationConsentAt: null,
          sourceKind: "page" as const,
          pageUrl,
          candidateFingerprint: source.candidateFingerprint ?? null,
        }
    if (
      session.sourceKind !== source.kind ||
      session.pageUrl !== pageUrl ||
      (source.candidateFingerprint &&
        session.candidateFingerprint !== source.candidateFingerprint)
    ) {
      throw new DownloadBatchOperationError(
        "短期工作階段與選取的影音來源不一致",
        "media-session-mismatch",
        400,
      )
    }
    const stableIdentity =
      source.candidateFingerprint ?? pageUrl
    return {
      kind: source.kind,
      pageUrl,
      sourceKey: `${source.kind}:${stableIdentity}`,
      sessionId: source.sessionId ?? null,
      candidateFingerprint: source.candidateFingerprint ?? null,
      authentication: session.authentication,
      authenticationConsentAt: session.authenticationConsentAt,
    }
  }

  private operation(operationId: string) {
    const operation = this.db
      .select()
      .from(operations)
      .where(eq(operations.id, operationId))
      .get()
    if (!operation) {
      throw new DownloadBatchOperationError(
        "下載工作狀態不存在",
        "operation-not-found",
        500,
      )
    }
    return operation
  }

  private updateOperation(
    operationId: string,
    values: Partial<typeof operations.$inferInsert>,
  ) {
    const current = this.operation(operationId)
    const changed = Object.entries(values).some(([key, value]) => {
      const previous = current[key as keyof typeof current]
      return typeof value === "object"
        ? JSON.stringify(previous) !== JSON.stringify(value)
        : previous !== value
    })
    if (!changed) return
    const timestamp = now()
    const next = { ...current, ...values, updatedAt: timestamp }
    this.db
      .update(operations)
      .set({ ...values, updatedAt: timestamp })
      .where(eq(operations.id, operationId))
      .run()
    const lastEvent = this.db
      .select({ sequence: operationEvents.sequence })
      .from(operationEvents)
      .where(eq(operationEvents.operationId, operationId))
      .orderBy(desc(operationEvents.sequence))
      .get()
    this.db
      .insert(operationEvents)
      .values({
        operationId,
        sequence: (lastEvent?.sequence ?? 0) + 1,
        type: "state-changed",
        state: String(next.state),
        stage: String(next.stage),
        progress: Number(next.progress),
        message: String(next.message),
        dataJson: {},
        createdAt: timestamp,
      })
      .run()
  }

  private updateItem(
    itemId: string,
    values: Partial<typeof downloadBatchItems.$inferInsert>,
  ) {
    this.db
      .update(downloadBatchItems)
      .set(values)
      .where(eq(downloadBatchItems.id, itemId))
      .run()
  }

  private schedule() {
    let occupied = this.active.size
    occupied += this.db
      .select()
      .from(downloadBatchItems)
      .all()
      .filter((item) => {
        const operation = this.operation(item.operationId)
        return (
          operation.state === "downloading" &&
          !this.active.has(item.id) &&
          processIsAlive(operation.pid)
        )
      }).length
    if (occupied >= this.concurrency) return
    const activeBatchIds = new Set(
      this.db
        .select({ id: downloadBatches.id })
        .from(downloadBatches)
        .where(eq(downloadBatches.state, "active"))
        .all()
        .map((batch) => batch.id),
    )
    const queued = this.db
      .select()
      .from(downloadBatchItems)
      .orderBy(asc(downloadBatchItems.createdAt), asc(downloadBatchItems.ordinal))
      .all()
      .filter(
        (item) =>
          activeBatchIds.has(item.batchId) &&
          this.operation(item.operationId).state === "queued",
      )
    for (const item of queued.slice(0, this.concurrency - occupied)) {
      this.launch(item)
    }
  }

  private launch(item: typeof downloadBatchItems.$inferSelect) {
    let session: ClaimedMediaSession | null = null
    try {
      session = item.sessionId ? this.mediaSessions.claim(item.sessionId) : null
    } catch (error) {
      const code =
        error instanceof MediaSessionOperationError
          ? error.code
          : "media-session-failed"
      this.updateOperation(item.operationId, {
        state: "failed",
        stage: "source-resolution",
        message: "瀏覽器媒體工作階段已失效，請重新加入",
        progress: 0,
        errorCode: code,
        errorMessage: "ephemeral media session unavailable",
        completedAt: now(),
      })
      this.updateItem(item.id, { completedAt: now() })
      this.refreshBatch(item.batchId)
      return
    }
    const targetUrl =
      session?.sourceUrl ?? item.pageUrl
    const refererUrl =
      session?.sourceKind === "network-media"
        ? session.frameUrl ?? session.pageUrl
        : item.pageUrl
    if (!targetUrl) {
      session?.dispose()
      this.updateOperation(item.operationId, {
        state: "failed",
        stage: "source-resolution",
        message: "影音來源缺少可下載網址",
        progress: 0,
        errorCode: "source-unavailable",
        errorMessage: "download source is unavailable",
        pid: null,
        completedAt: now(),
      })
      this.updateItem(item.id, { completedAt: now() })
      this.refreshBatch(item.batchId)
      this.schedule()
      return
    }
    let scriptPath: string
    try {
      scriptPath = this.script()
    } catch (error) {
      session?.dispose()
      const timestamp = now()
      this.updateOperation(item.operationId, {
        state: "failed",
        stage: "start",
        message: "影音下載程式無法使用",
        progress: 0,
        errorCode: "runtime-unavailable",
        errorMessage: error instanceof Error ? error.message : String(error),
        pid: null,
        completedAt: timestamp,
      })
      this.updateItem(item.id, { completedAt: timestamp })
      this.refreshBatch(item.batchId)
      this.schedule()
      return
    }
    const args = [
      scriptPath,
      this.workspace,
      targetUrl,
      "--download-only",
      "--library-source-url",
      item.pageUrl,
      "--source-kind",
      item.sourceKind,
      "--referer",
      refererUrl,
    ]
    if (session?.cookieFile) args.push("--cookie-file", session.cookieFile)
    if (item.lowQualityApproved) args.push("--allow-low-quality")
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(args, {
        cwd: this.workspace,
        stdout: "ignore",
        stderr: "pipe",
      })
    } catch {
      session?.dispose()
      const timestamp = now()
      this.updateOperation(item.operationId, {
        state: "failed",
        stage: "start",
        message: "無法啟動下載",
        errorCode: "start-failed",
        errorMessage: "download process failed to start",
        completedAt: timestamp,
      })
      this.updateItem(item.id, { completedAt: timestamp })
      this.refreshBatch(item.batchId)
      this.schedule()
      return
    }
    this.active.set(item.id, {
      child,
      dispose: session?.dispose ?? (() => undefined),
    })
    this.updateOperation(item.operationId, {
      state: "downloading",
      stage: "media-download",
      message: "正在下載影音",
      progress: 0,
      errorCode: null,
      errorMessage: null,
      pid: child.pid,
      startedAt: now(),
      completedAt: null,
    })
    void this.finish(item, child)
  }

  private async finish(
    item: typeof downloadBatchItems.$inferSelect,
    child: ReturnType<typeof Bun.spawn>,
  ) {
    const stderrPromise =
      typeof child.stderr === "number" || child.stderr === undefined
        ? Promise.resolve("")
        : new Response(child.stderr).text()
    const [exitCode, stderr] = await Promise.all([child.exited, stderrPromise])
    const active = this.active.get(item.id)
    active?.dispose()
    this.active.delete(item.id)
    const cancelled = this.cancelled.delete(item.id)
    const job = this.jobs
      .list()
      .find((candidate) => candidate.sourceUrl === item.pageUrl)
    const timestamp = now()
    if (cancelled) {
      this.updateOperation(item.operationId, {
        state: "cancelled",
        stage: "cancelled",
        message: "下載已取消",
        errorCode: null,
        errorMessage: null,
        pid: null,
        completedAt: timestamp,
      })
      this.updateItem(item.id, { completedAt: timestamp })
    } else if (exitCode === 0 && job?.state === "downloaded") {
      this.updateOperation(item.operationId, {
        videoId: job.videoId,
        state: "downloaded",
        stage: "complete",
        message: "影音已下載，等待處理",
        progress: 100,
        outputsJson: { videoId: job.videoId },
        errorCode: null,
        errorMessage: null,
        pid: null,
        completedAt: timestamp,
      })
      this.updateItem(item.id, {
        videoId: job.videoId,
        completedAt: timestamp,
      })
    } else if (
      stderr.includes("low-quality fallback requires user confirmation")
    ) {
      this.updateOperation(item.operationId, {
        videoId: job?.videoId ?? null,
        state: "needs_confirmation",
        stage: "quality-confirmation",
        message: "可用畫質低於 720p，需要你的確認",
        progress: 0,
        errorCode: "low-quality-confirmation-required",
        errorMessage: "quality below 720p requires confirmation",
        pid: null,
        completedAt: null,
      })
      this.updateItem(item.id, { videoId: job?.videoId ?? null })
    } else {
      this.updateOperation(item.operationId, {
        videoId: job?.videoId ?? null,
        state: "failed",
        stage: "media-download",
        message: "影音下載失敗",
        progress: 0,
        errorCode: "download-failed",
        errorMessage: "download process failed",
        pid: null,
        completedAt: timestamp,
      })
      this.updateItem(item.id, {
        videoId: job?.videoId ?? null,
        completedAt: timestamp,
      })
    }
    this.refreshBatch(item.batchId)
    this.schedule()
  }

  private synchronize() {
    const jobs = this.jobs.list()
    const byUrl = new Map(jobs.map((job) => [job.sourceUrl, job]))
    for (const item of this.db.select().from(downloadBatchItems).all()) {
      const operation = this.operation(item.operationId)
      if (!ACTIVE_ITEM_STATES.has(operation.state)) continue
      const job = byUrl.get(item.pageUrl)
      if (operation.state === "downloading" && job) {
        const state = job.state === "downloaded" ? "downloaded" : "downloading"
        this.updateOperation(item.operationId, {
          videoId: job.videoId,
          state,
          stage: job.state === "downloaded" ? "complete" : job.stage,
          progress: job.state === "downloaded" ? 100 : job.progress,
          message:
            job.state === "downloaded"
              ? "影音已下載，等待處理"
              : job.message || "正在下載影音",
          outputsJson: job.state === "downloaded" ? { videoId: job.videoId } : {},
          completedAt: job.state === "downloaded" ? now() : null,
        })
        this.updateItem(item.id, {
          videoId: job.videoId,
          completedAt: job.state === "downloaded" ? now() : null,
        })
      }
      if (
        operation.state === "downloading" &&
        !this.active.has(item.id) &&
        !processIsAlive(operation.pid) &&
        job?.state !== "downloaded"
      ) {
        this.updateOperation(item.operationId, {
          state: "failed",
          stage: "interrupted",
          message: "下載程序已中斷",
          errorCode: "interrupted",
          errorMessage: "download process interrupted",
          pid: null,
          completedAt: now(),
        })
        this.updateItem(item.id, { completedAt: now() })
      }
      this.refreshBatch(item.batchId)
    }
    this.schedule()
  }

  private refreshBatch(batchId: string) {
    const items = this.db
      .select()
      .from(downloadBatchItems)
      .where(eq(downloadBatchItems.batchId, batchId))
      .all()
    const current = this.db
      .select({ state: downloadBatches.state })
      .from(downloadBatches)
      .where(eq(downloadBatches.id, batchId))
      .get()
    const states = items.map((item) => this.operation(item.operationId).state)
    const hasActiveItems = states.some((state) => ACTIVE_ITEM_STATES.has(state))
    const state = !hasActiveItems
      ? "complete"
      : current?.state === "paused"
        ? "paused"
        : "active"
    this.db
      .update(downloadBatches)
      .set({ state, updatedAt: now() })
      .where(eq(downloadBatches.id, batchId))
      .run()
  }

  retry(batchId: string, itemId: string, lowQualityApproved = false) {
    const item = this.item(batchId, itemId)
    const operation = this.operation(item.operationId)
    if (!["failed", "cancelled", "needs_confirmation"].includes(operation.state)) {
      throw new DownloadBatchOperationError(
        "目前狀態不能重新下載",
        "retry-not-allowed",
        409,
      )
    }
    if (item.sessionId && !this.mediaSessions.has(item.sessionId)) {
      throw new DownloadBatchOperationError(
        "瀏覽器媒體工作階段已失效，請重新從擴充功能加入",
        "media-session-expired",
        409,
      )
    }
    this.updateOperation(item.operationId, {
      state: "queued",
      stage: "awaiting-download",
      message: "等待下載",
      progress: 0,
      errorCode: null,
      errorMessage: null,
      pid: null,
      attempt: operation.attempt + 1,
      completedAt: null,
    })
    this.updateItem(item.id, {
      lowQualityApproved: lowQualityApproved || item.lowQualityApproved,
      completedAt: null,
    })
    this.refreshBatch(batchId)
    this.schedule()
    return this.batch(batchId)
  }

  pause(batchId: string) {
    const batch = this.db
      .select()
      .from(downloadBatches)
      .where(eq(downloadBatches.id, batchId))
      .get()
    if (!batch) {
      throw new DownloadBatchOperationError(
        "下載批次不存在",
        "batch-not-found",
        404,
      )
    }
    if (batch.state !== "active") {
      throw new DownloadBatchOperationError(
        "目前批次不能暫停",
        "pause-not-allowed",
        409,
      )
    }
    this.db
      .update(downloadBatches)
      .set({ state: "paused", updatedAt: now() })
      .where(eq(downloadBatches.id, batchId))
      .run()
    return this.batch(batchId)
  }

  resume(batchId: string) {
    const batch = this.db
      .select()
      .from(downloadBatches)
      .where(eq(downloadBatches.id, batchId))
      .get()
    if (!batch) {
      throw new DownloadBatchOperationError(
        "下載批次不存在",
        "batch-not-found",
        404,
      )
    }
    if (batch.state !== "paused") {
      throw new DownloadBatchOperationError(
        "目前批次不能繼續",
        "resume-not-allowed",
        409,
      )
    }
    this.db
      .update(downloadBatches)
      .set({ state: "active", updatedAt: now() })
      .where(eq(downloadBatches.id, batchId))
      .run()
    this.schedule()
    return this.batch(batchId)
  }

  cancel(batchId: string, itemId: string) {
    const item = this.item(batchId, itemId)
    const operation = this.operation(item.operationId)
    if (operation.state === "queued") {
      const timestamp = now()
      this.updateOperation(item.operationId, {
        state: "cancelled",
        stage: "cancelled",
        message: "下載已取消",
        completedAt: timestamp,
      })
      this.updateItem(item.id, { completedAt: timestamp })
    } else if (operation.state === "downloading") {
      const active = this.active.get(item.id)
      if (!active) {
        throw new DownloadBatchOperationError(
          "下載程序不屬於目前服務，請等待狀態更新",
          "process-not-owned",
          409,
        )
      }
      this.cancelled.add(item.id)
      active.child.kill("SIGTERM")
    } else {
      throw new DownloadBatchOperationError(
        "目前狀態不能取消",
        "cancel-not-allowed",
        409,
      )
    }
    this.refreshBatch(batchId)
    return this.batch(batchId)
  }

  private item(batchId: string, itemId: string) {
    const item = this.db
      .select()
      .from(downloadBatchItems)
      .where(eq(downloadBatchItems.id, itemId))
      .get()
    if (!item || item.batchId !== batchId) {
      throw new DownloadBatchOperationError(
        "下載項目不存在",
        "item-not-found",
        404,
      )
    }
    return item
  }
}
