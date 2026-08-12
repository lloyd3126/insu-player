import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"

import { asc, desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  downloadQueueItems,
  downloadQueueSettings,
  jobs,
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
  CreateLibraryItemsResponse,
  DownloadLibraryItem,
  DownloadQueueItemState,
  DownloadSourceInput,
  LibraryItem,
  LibraryResponse,
} from "@shared/contracts/library"

const MAX_CREATE_SIZE = 50
const QUEUE_SETTINGS_ID = "default"
const ACTIVE_ITEM_STATES = new Set<DownloadQueueItemState>([
  "checking",
  "queued",
  "downloading",
  "verifying",
  "needs_confirmation",
])
const PROCESS_ITEM_STATES = new Set<DownloadQueueItemState>([
  "checking",
  "downloading",
  "verifying",
])
function libraryItemPriority(item: LibraryItem) {
  if (item.kind === "media") return 4
  if (item.kind === "import") return 4
  if (PROCESS_ITEM_STATES.has(item.state)) return 0
  if (["queued", "paused"].includes(item.state)) return 1
  if (["needs_confirmation", "failed"].includes(item.state)) return 2
  return 3
}

function compareLibraryItems(left: LibraryItem, right: LibraryItem) {
  const priority = libraryItemPriority(left) - libraryItemPriority(right)
  if (priority !== 0) return priority
  if (
    left.kind === "download" &&
    right.kind === "download" &&
    left.state === "queued" &&
    right.state === "queued"
  ) {
    return (left.queueAhead ?? Number.MAX_SAFE_INTEGER) -
      (right.queueAhead ?? Number.MAX_SAFE_INTEGER)
  }
  const leftAt = left.kind === "media" ? left.job.updatedAt : left.updatedAt
  const rightAt = right.kind === "media" ? right.job.updatedAt : right.updatedAt
  return rightAt.localeCompare(leftAt)
}

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

function stopProcess(child: ReturnType<typeof Bun.spawn>) {
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

function normalizeWebUrl(value: string, label: string, maxLength = 8_192) {
  if (!value || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new DownloadQueueOperationError(`${label}無效`, "invalid-url", 400)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new DownloadQueueOperationError(
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
    throw new DownloadQueueOperationError(`${label}無效`, "invalid-url", 400)
  }
  if (url.searchParams.has("list") || /(?:^|\/)playlist(?:\/|$)/i.test(url.pathname)) {
    throw new DownloadQueueOperationError(
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

export class DownloadQueueOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class DownloadQueueService {
  private readonly active = new Map<
    string,
    {
      child: ReturnType<typeof Bun.spawn>
      session: ClaimedMediaSession | null
      completion: Promise<void>
    }
  >()
  private readonly pausedSessions = new Map<string, ClaimedMediaSession>()
  private readonly termination = new Map<string, "pause" | "remove">()

  constructor(
    private readonly workspace: string,
    private readonly db: AppDatabase,
    private readonly jobs: JobRepository,
    private readonly downloadScript: string,
    private readonly mediaSessions: MediaSessionService,
    private readonly defaultConcurrency = 2,
  ) {
    this.ensureSettings()
  }

  private ensureSettings() {
    const timestamp = now()
    this.db
      .insert(downloadQueueSettings)
      .values({
        id: QUEUE_SETTINGS_ID,
        paused: false,
        concurrency: this.defaultConcurrency,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run()
    return this.readSettings()
  }

  private readSettings() {
    const settings = this.db
      .select()
      .from(downloadQueueSettings)
      .where(eq(downloadQueueSettings.id, QUEUE_SETTINGS_ID))
      .get()
    if (!settings || settings.concurrency < 1 || settings.concurrency > 8) {
      throw new DownloadQueueOperationError(
        "下載排程設定無效",
        "invalid-queue-settings",
        500,
      )
    }
    return settings
  }

  private script() {
    if (
      !existsSync(this.downloadScript) ||
      lstatSync(this.downloadScript).isSymbolicLink() ||
      !lstatSync(this.downloadScript).isFile()
    ) {
      throw new DownloadQueueOperationError(
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
  ): CreateLibraryItemsResponse {
    if (!rightsConfirmed) {
      throw new DownloadQueueOperationError(
        "開始下載前請先確認內容權利",
        "rights-not-confirmed",
        400,
      )
    }
    if (
      !Array.isArray(sources) ||
      sources.length === 0 ||
      sources.length > MAX_CREATE_SIZE
    ) {
      throw new DownloadQueueOperationError(
        `每次請加入 1 到 ${MAX_CREATE_SIZE} 個影音來源`,
        "invalid-create-size",
        400,
      )
    }
    const normalized = sources.map((source) => this.normalizeSource(source))
    const itemIds: string[] = []
    for (const source of normalized) {
      const queued = this.db
        .select()
        .from(downloadQueueItems)
        .where(eq(downloadQueueItems.sourceKey, source.sourceKey))
        .get()
      if (queued) {
        this.requeueExisting(queued, source)
        itemIds.push(queued.id)
        continue
      }
      const itemId = `library-${crypto.randomUUID()}`
      const operationId = `download-${crypto.randomUUID()}`
      const timestamp = now()
      this.db.transaction((transaction) => {
        transaction
          .insert(operations)
          .values({
            id: operationId,
            videoId: null,
            parentOperationId: null,
            kind: "media-download",
            state: "queued",
            stage: "awaiting-download",
            progress: 0,
            message: "等待下載",
            inputsJson: {
              sourceKind: source.kind,
              pageUrl: source.pageUrl,
              candidateFingerprint: source.candidateFingerprint,
              sessionRequired: Boolean(source.sessionId),
            },
            outputsJson: {},
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
            completedAt: null,
          })
          .run()
        transaction
          .insert(operationEvents)
          .values({
            operationId,
            sequence: 1,
            type: "created",
            state: "queued",
            stage: "awaiting-download",
            progress: 0,
            message: "等待下載",
            dataJson: {},
            createdAt: timestamp,
          })
          .run()
        transaction
          .insert(downloadQueueItems)
          .values({
            id: itemId,
            sourceKind: source.kind,
            pageUrl: source.pageUrl,
            sourceUrl: source.pageUrl,
            sourceKey: source.sourceKey,
            sessionId: source.sessionId,
            operationId,
            videoId: null,
            rightsConfirmed: true,
            lowQualityApproved: false,
            authentication: source.authentication,
            authenticationConsentAt: source.authenticationConsentAt,
            createdAt: timestamp,
            completedAt: null,
          })
          .run()
      })
      itemIds.push(itemId)
    }
    this.schedule()
    return { accepted: true, itemIds }
  }

  private requeueExisting(
    item: typeof downloadQueueItems.$inferSelect,
    source: NormalizedSource,
  ) {
    if (!item.rightsConfirmed) {
      throw new DownloadQueueOperationError(
        "下載項目缺少內容權利確認",
        "rights-not-confirmed",
        409,
      )
    }
    const operation = this.operation(item.operationId)
    const job = item.videoId
      ? this.jobs
          .list()
          .find((candidate) => candidate.videoId === item.videoId)
      : undefined
    this.updateItem(item.id, {
      sessionId: source.sessionId,
      authentication: source.authentication,
      authenticationConsentAt: source.authenticationConsentAt,
    })
    if (
      ![
        "downloaded",
        "failed",
        "cancelled",
        "paused",
        "needs_confirmation",
      ].includes(
        operation.state,
      )
    ) return
    this.updateOperation(item.operationId, {
      state: "queued",
      stage: "awaiting-download",
      message: "等待下載",
      progress: 0,
      inputsJson: {
        sourceKind: source.kind,
        pageUrl: source.pageUrl,
        candidateFingerprint: source.candidateFingerprint,
        sessionRequired: Boolean(source.sessionId),
        ...(job?.watchable && typeof job.updatedAt === "string"
          ? { redownloadBaselineUpdatedAt: job.updatedAt }
          : {}),
      },
      consentJson: {
        rightsConfirmed: true,
        authentication: source.authentication,
        authenticationConsentAt: source.authenticationConsentAt,
      },
      resumable: !source.sessionId,
      attempt: operation.attempt + 1,
      pid: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    })
    this.updateItem(item.id, {
      lowQualityApproved: false,
      completedAt: null,
    })
  }

  private attemptHasPublishedMedia(
    operation: typeof operations.$inferSelect,
    job: {
      watchable: boolean
      state: string
      updatedAt: string | null
    } | undefined,
  ) {
    if (!job?.watchable) return false
    const baseline = operation.inputsJson.redownloadBaselineUpdatedAt
    if (typeof baseline !== "string") return true
    return typeof job.updatedAt === "string" &&
      job.state === "downloaded" &&
      job.updatedAt > baseline
  }

  list(): LibraryResponse {
    const summaries = this.jobs.list()
    this.synchronize(summaries)
    const settings = this.readSettings()
    const rows = this.db
      .select()
      .from(downloadQueueItems)
      .orderBy(asc(downloadQueueItems.createdAt))
      .all()
    const jobsById = new Map(summaries.map((job) => [job.videoId, job]))
    const associatedVideoIds = new Set(
      rows
        .map((item) =>
          typeof this.operation(item.operationId).inputsJson
            .redownloadBaselineUpdatedAt === "string"
            ? null
            : item.videoId,
        )
        .filter((videoId): videoId is string => Boolean(videoId)),
    )
    const queuedIds: string[] = []
    for (const item of rows) {
      const operation = this.operation(item.operationId)
      const job = item.videoId ? jobsById.get(item.videoId) : undefined
      if (
        !this.attemptHasPublishedMedia(operation, job) &&
        operation.state === "queued"
      ) {
        queuedIds.push(item.id)
      }
    }
    const linkedVideoIds = new Set<string>()
    const items: LibraryItem[] = rows.map((item) => {
      const operation = this.operation(item.operationId)
      const job = item.videoId ? jobsById.get(item.videoId) : undefined
      const published = this.attemptHasPublishedMedia(operation, job)
      if (job && published) linkedVideoIds.add(job.videoId)
      if (job && published) {
        return { kind: "media", id: item.id, job }
      }
      return this.publicDownloadItem(
        item,
        operation,
        job,
        operation.state === "queued" ? queuedIds.indexOf(item.id) : null,
      )
    })
    for (const job of summaries) {
      if (
        !linkedVideoIds.has(job.videoId) &&
        !associatedVideoIds.has(job.videoId)
      ) {
        items.push({ kind: "media", id: `media:${job.videoId}`, job })
      }
    }
    items.sort(compareLibraryItems)
    const states = rows.flatMap((item) => {
      const operation = this.operation(item.operationId)
      const job = item.videoId ? jobsById.get(item.videoId) : undefined
      return this.attemptHasPublishedMedia(operation, job)
        ? []
        : [operation.state]
    })
    return {
      items,
      queue: {
        paused: settings.paused,
        concurrency: settings.concurrency,
        queuedCount: states.filter((state) => state === "queued").length,
        activeCount: states.filter((state) =>
          PROCESS_ITEM_STATES.has(state as DownloadQueueItemState),
        ).length,
        attentionCount: states.filter((state) =>
          ["needs_confirmation", "failed", "cancelled"].includes(state),
        ).length,
      },
      serverTime: now(),
    }
  }

  private publicDownloadItem(
    item: typeof downloadQueueItems.$inferSelect,
    operation: typeof operations.$inferSelect,
    job: ReturnType<JobRepository["list"]>[number] | undefined,
    queueAhead: number | null,
  ): DownloadLibraryItem {
    let title = job?.title
    if (!title) {
      try {
        title = new URL(item.pageUrl).hostname
      } catch {
        title = "等待下載的影音"
      }
    }
    return {
      kind: "download",
      id: item.id,
      sourceKind: item.sourceKind as DownloadLibraryItem["sourceKind"],
      pageUrl: item.pageUrl,
      sourceUrl: item.sourceUrl,
      videoId: item.videoId,
      title,
      thumbnailUrl: job?.thumbnailUrl ?? null,
      state: operation.state as DownloadQueueItemState,
      stage: operation.stage,
      progress: operation.progress,
      message: operation.message,
      errorCode: operation.errorCode,
      queueAhead,
      lowQualityApproved: item.lowQualityApproved,
      authentication: item.authentication as DownloadLibraryItem["authentication"],
      authenticationConsentAt: item.authenticationConsentAt,
      createdAt: item.createdAt,
      updatedAt: operation.updatedAt,
      completedAt: item.completedAt,
    }
  }

  private normalizeSource(source: DownloadSourceInput): NormalizedSource {
    if (!source || !["page", "embed", "network-media"].includes(source.kind)) {
      throw new DownloadQueueOperationError(
        "影音來源類型無效",
        "invalid-source",
        400,
      )
    }
    const pageUrl = normalizeWebUrl(source.pageUrl, "頁面網址", 2_048)
    if (source.kind !== "page" && !source.sessionId) {
      throw new DownloadQueueOperationError(
        "嵌入或網路媒體需要短期工作階段",
        "media-session-required",
        400,
      )
    }
    if (
      source.candidateFingerprint &&
      !/^[0-9a-f]{64}$/.test(source.candidateFingerprint)
    ) {
      throw new DownloadQueueOperationError(
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
      throw new DownloadQueueOperationError(
        "短期工作階段與選取的影音來源不一致",
        "media-session-mismatch",
        400,
      )
    }
    const stableIdentity =
      source.kind === "page"
        ? pageUrl
        : source.candidateFingerprint ?? pageUrl
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
      throw new DownloadQueueOperationError(
        "下載工作狀態不存在",
        "operation-not-found",
        500,
      )
    }
    return operation
  }

  private item(itemId: string) {
    const item = this.db
      .select()
      .from(downloadQueueItems)
      .where(eq(downloadQueueItems.id, itemId))
      .get()
    if (!item) {
      throw new DownloadQueueOperationError(
        "下載項目不存在",
        "item-not-found",
        404,
      )
    }
    return item
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
    values: Partial<typeof downloadQueueItems.$inferInsert>,
  ) {
    this.db
      .update(downloadQueueItems)
      .set(values)
      .where(eq(downloadQueueItems.id, itemId))
      .run()
  }

  private reconcilePublishedMedia(
    item: typeof downloadQueueItems.$inferSelect,
    job: ReturnType<JobRepository["list"]>[number],
  ) {
    if (!job.watchable) return false
    const operation = this.operation(item.operationId)
    const completedAt =
      operation.state === "downloaded"
        ? (operation.completedAt ?? job.updatedAt)
        : job.updatedAt
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
      completedAt,
    })
    if (item.videoId !== job.videoId || !item.completedAt) {
      this.updateItem(item.id, {
        videoId: job.videoId,
        completedAt,
      })
    }
    return true
  }

  private schedule() {
    const settings = this.readSettings()
    if (settings.paused) return
    let occupied = this.active.size
    occupied += this.db
      .select()
      .from(downloadQueueItems)
      .all()
      .filter((item) => {
        const operation = this.operation(item.operationId)
        return (
          PROCESS_ITEM_STATES.has(operation.state as DownloadQueueItemState) &&
          !this.active.has(item.id) &&
          processIsAlive(operation.pid)
        )
      }).length
    if (occupied >= settings.concurrency) return
    const queued = this.db
      .select()
      .from(downloadQueueItems)
      .orderBy(asc(downloadQueueItems.createdAt))
      .all()
      .filter((item) => this.operation(item.operationId).state === "queued")
    for (const item of queued.slice(0, settings.concurrency - occupied)) {
      this.launch(item)
    }
  }

  private launch(item: typeof downloadQueueItems.$inferSelect) {
    const operation = this.operation(item.operationId)
    let session = this.pausedSessions.get(item.id) ?? null
    this.pausedSessions.delete(item.id)
    try {
      session ??= item.sessionId ? this.mediaSessions.claim(item.sessionId) : null
    } catch (error) {
      const code =
        error instanceof MediaSessionOperationError
          ? error.code
          : "media-session-failed"
      this.failItem(
        item,
        "source-resolution",
        "本次來源資料已失效，請回到原分頁重新加入",
        code,
        "ephemeral media session unavailable",
      )
      return
    }
    const sourceUrls = session?.sourceUrls ?? [item.pageUrl]
    const targetUrl = sourceUrls[0]
    const refererUrl = session?.pageUrl ?? item.pageUrl
    if (!targetUrl) {
      session?.dispose()
      this.failItem(
        item,
        "source-resolution",
        "影音來源缺少可下載網址",
        "source-unavailable",
        "download source is unavailable",
      )
      return
    }
    let scriptPath: string
    try {
      scriptPath = this.script()
    } catch (error) {
      session?.dispose()
      this.failItem(
        item,
        "start",
        "影音下載程式無法使用",
        "runtime-unavailable",
        error instanceof Error ? error.message : String(error),
      )
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
      "--queue-item-id",
      item.id,
      "--referer",
      refererUrl,
    ]
    for (const fallbackUrl of sourceUrls.slice(1)) {
      args.push("--fallback-url", fallbackUrl)
    }
    if (session?.cookieFile) args.push("--cookie-file", session.cookieFile)
    if (item.lowQualityApproved) args.push("--allow-low-quality")
    if (operation.inputsJson.resumePartial === true) args.push("--resume-partial")
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(args, {
        cwd: this.workspace,
        detached: true,
        stdout: "ignore",
        stderr: "pipe",
      })
    } catch {
      session?.dispose()
      this.failItem(
        item,
        "start",
        "無法啟動下載",
        "start-failed",
        "download process failed to start",
      )
      return
    }
    const active = {
      child,
      session,
      completion: Promise.resolve(),
    }
    this.active.set(item.id, active)
    this.updateOperation(item.operationId, {
      state: "checking",
      stage: "source-resolution",
      message: "正在確認影音來源",
      progress: 1,
      errorCode: null,
      errorMessage: null,
      pid: child.pid,
      startedAt: now(),
      completedAt: null,
    })
    active.completion = this.finish(item, child).catch(() =>
      this.settleUnexpectedFailure(item),
    )
  }

  private failItem(
    item: typeof downloadQueueItems.$inferSelect,
    stage: string,
    message: string,
    errorCode: string,
    errorMessage: string,
  ) {
    const timestamp = now()
    this.updateOperation(item.operationId, {
      state: "failed",
      stage,
      message,
      progress: 0,
      errorCode,
      errorMessage,
      pid: null,
      completedAt: timestamp,
    })
    this.updateItem(item.id, { completedAt: timestamp })
    this.schedule()
  }

  private settleUnexpectedFailure(item: typeof downloadQueueItems.$inferSelect) {
    try {
      const active = this.active.get(item.id)
      const termination = this.termination.get(item.id)
      this.termination.delete(item.id)
      if (termination === "pause" && active?.session) {
        this.pausedSessions.set(item.id, active.session)
      } else {
        active?.session?.dispose()
      }
      this.active.delete(item.id)
      if (termination === "pause") {
        this.updateOperation(item.operationId, {
          state: "paused",
          stage: "paused",
          message: "下載已暫停",
          pid: null,
          completedAt: null,
        })
        return
      }
      if (termination === "remove") {
        this.updateOperation(item.operationId, {
          state: "cancelled",
          stage: "cancelled",
          message: "下載已停止",
          pid: null,
          completedAt: now(),
        })
        return
      }
      this.failItem(
        item,
        "internal-error",
        "下載完成狀態無法確認，首頁服務仍保持運作",
        "download-finalization-failed",
        "download finalization failed",
      )
    } catch {
      this.active.delete(item.id)
      this.termination.delete(item.id)
    }
  }

  private async finish(
    item: typeof downloadQueueItems.$inferSelect,
    child: ReturnType<typeof Bun.spawn>,
  ) {
    const stderrPromise =
      typeof child.stderr === "number" || child.stderr === undefined
        ? Promise.resolve("")
        : new Response(child.stderr).text()
    const [exitCode, stderr] = await Promise.all([child.exited, stderrPromise])
    const active = this.active.get(item.id)
    const termination = this.termination.get(item.id)
    this.termination.delete(item.id)
    if (termination === "pause" && active?.session) {
      this.pausedSessions.set(item.id, active.session)
    } else {
      active?.session?.dispose()
    }
    this.active.delete(item.id)
    const refreshedItem = this.item(item.id)
    const job = refreshedItem.videoId
      ? this.jobs
          .list()
          .find((candidate) => candidate.videoId === refreshedItem.videoId)
      : undefined
    const timestamp = now()
    const operation = this.operation(item.operationId)
    if (
      exitCode === 0 &&
      job &&
      this.attemptHasPublishedMedia(operation, job)
    ) {
      this.reconcilePublishedMedia(refreshedItem, job)
    } else if (termination === "pause") {
      this.updateOperation(item.operationId, {
        state: "paused",
        stage: "paused",
        message: "下載已暫停",
        errorCode: null,
        errorMessage: null,
        pid: null,
        completedAt: null,
      })
      this.updateItem(item.id, { completedAt: null })
    } else if (termination === "remove") {
      this.updateOperation(item.operationId, {
        state: "cancelled",
        stage: "cancelled",
        message: "下載已停止",
        errorCode: null,
        errorMessage: null,
        pid: null,
        completedAt: timestamp,
      })
      this.updateItem(item.id, { completedAt: timestamp })
    } else if (stderr.includes("low-quality fallback requires user confirmation")) {
      this.updateOperation(item.operationId, {
        videoId: refreshedItem.videoId,
        state: "needs_confirmation",
        stage: "quality-confirmation",
        message: "可用畫質低於 720p，需要你的確認",
        progress: 0,
        errorCode: "low-quality-confirmation-required",
        errorMessage: "quality below 720p requires confirmation",
        pid: null,
        completedAt: null,
      })
      this.updateItem(refreshedItem.id, { videoId: refreshedItem.videoId })
    } else {
      this.failItem(
        item,
        "media-download",
        "影音下載失敗",
        "download-failed",
        "download process failed",
      )
    }
    this.schedule()
  }

  private synchronize(
    jobs: ReturnType<JobRepository["list"]> = this.jobs.list(),
  ) {
    const byId = new Map(jobs.map((job) => [job.videoId, job]))
    for (const item of this.db.select().from(downloadQueueItems).all()) {
      const operation = this.operation(item.operationId)
      const job = item.videoId ? byId.get(item.videoId) : undefined
      if (job && this.attemptHasPublishedMedia(operation, job)) {
        this.reconcilePublishedMedia(item, job)
        continue
      }
      if (!ACTIVE_ITEM_STATES.has(operation.state as DownloadQueueItemState)) continue
      if (PROCESS_ITEM_STATES.has(operation.state as DownloadQueueItemState) && job) {
        const isVerifying = ["media_validation", "media_publish"].includes(job.stage)
        const state = isVerifying
          ? "verifying"
          : job.state === "checking"
            ? "checking"
            : "downloading"
        const progress = Math.max(
          operation.progress,
          Math.min(99, Math.round(job.progress * 10) / 10),
        )
        this.updateOperation(item.operationId, {
          videoId: job.videoId,
          state,
          stage: job.stage,
          progress,
          message: job.message || "正在下載影音",
          outputsJson: {},
          completedAt: null,
        })
        this.updateItem(item.id, {
          videoId: job.videoId,
          completedAt: null,
        })
      }
      if (
        PROCESS_ITEM_STATES.has(operation.state as DownloadQueueItemState) &&
        !this.active.has(item.id) &&
        !processIsAlive(operation.pid) &&
        !job?.state.startsWith("downloaded")
      ) {
        this.failItem(
          item,
          "interrupted",
          "下載程序已中斷",
          "interrupted",
          "download process interrupted",
        )
      }
    }
    this.schedule()
  }

  start(itemId: string, lowQualityApproved = false) {
    const item = this.item(itemId)
    const operation = this.operation(item.operationId)
    const published = this.jobs
      .list()
      .find((job) => job.watchable && job.videoId === item.videoId)
    if (published && this.attemptHasPublishedMedia(operation, published)) {
      this.reconcilePublishedMedia(item, published)
      return this.list()
    }
    if (
      ![
        "queued",
        "paused",
        "failed",
        "cancelled",
        "needs_confirmation",
      ].includes(operation.state)
    ) {
      throw new DownloadQueueOperationError(
        "目前狀態不能開始下載",
        "start-not-allowed",
        409,
      )
    }
    if (
      !operation.resumable &&
      !this.pausedSessions.has(item.id) &&
      (!item.sessionId || !this.mediaSessions.has(item.sessionId))
    ) {
      throw new DownloadQueueOperationError(
        "本次來源資料已失效，請回到原分頁重新加入",
        "media-session-expired",
        409,
      )
    }
    const wasPaused = operation.state === "paused"
    if (operation.state !== "queued" || lowQualityApproved) {
      this.updateOperation(item.operationId, {
        state: "queued",
        stage: "awaiting-download",
        message: wasPaused ? "等待繼續下載" : "等待下載",
        progress: wasPaused ? operation.progress : 0,
        inputsJson: {
          ...operation.inputsJson,
          resumePartial: wasPaused,
        },
        errorCode: null,
        errorMessage: null,
        pid: null,
        attempt: operation.state === "queued"
          ? operation.attempt
          : operation.attempt + 1,
        completedAt: null,
      })
    }
    this.updateItem(item.id, {
      lowQualityApproved: lowQualityApproved || item.lowQualityApproved,
      completedAt: null,
    })
    const settings = this.ensureSettings()
    if (settings.paused && this.active.size < settings.concurrency) {
      this.launch(this.item(item.id))
    } else {
      this.schedule()
    }
    return this.list()
  }

  approveLowQuality(itemId: string) {
    const item = this.item(itemId)
    if (this.operation(item.operationId).state !== "needs_confirmation") {
      throw new DownloadQueueOperationError(
        "目前項目不需要畫質確認",
        "quality-approval-not-allowed",
        409,
      )
    }
    return this.start(itemId, true)
  }

  pause() {
    const settings = this.ensureSettings()
    if (settings.paused) {
      throw new DownloadQueueOperationError(
        "下載排程已暫停",
        "pause-not-allowed",
        409,
      )
    }
    this.db
      .update(downloadQueueSettings)
      .set({ paused: true, updatedAt: now() })
      .where(eq(downloadQueueSettings.id, QUEUE_SETTINGS_ID))
      .run()
    return this.list()
  }

  resume() {
    const settings = this.ensureSettings()
    if (!settings.paused) {
      throw new DownloadQueueOperationError(
        "下載排程正在執行",
        "resume-not-allowed",
        409,
      )
    }
    this.db
      .update(downloadQueueSettings)
      .set({ paused: false, updatedAt: now() })
      .where(eq(downloadQueueSettings.id, QUEUE_SETTINGS_ID))
      .run()
    this.schedule()
    return this.list()
  }

  async pauseItem(itemId: string) {
    const item = this.item(itemId)
    const operation = this.operation(item.operationId)
    if (!PROCESS_ITEM_STATES.has(operation.state as DownloadQueueItemState)) {
      throw new DownloadQueueOperationError(
        "目前狀態不能暫停下載",
        "pause-item-not-allowed",
        409,
      )
    }
    const active = this.active.get(item.id)
    if (!active) {
      throw new DownloadQueueOperationError(
        "下載程序不屬於目前服務，請等待狀態更新",
        "process-not-owned",
        409,
      )
    }
    this.termination.set(item.id, "pause")
    stopProcess(active.child)
    await active.completion
    return this.list()
  }

  private removeUnfinishedFiles(
    item: typeof downloadQueueItems.$inferSelect,
    preservePublishedMedia: boolean,
  ) {
    if (!item.videoId) return
    const jobDirectory = this.jobs.jobDirectory(item.videoId)
    if (!existsSync(jobDirectory)) return
    if (!preservePublishedMedia) {
      rmSync(jobDirectory, { recursive: true, force: true })
      return
    }
    const sourceDirectory = path.join(jobDirectory, "source")
    if (!existsSync(sourceDirectory)) return
    for (const name of readdirSync(sourceDirectory)) {
      if (name.startsWith(".video-download-")) {
        rmSync(path.join(sourceDirectory, name), { recursive: true, force: true })
      }
    }
  }

  async remove(itemId: string) {
    let item = this.item(itemId)
    let operation = this.operation(item.operationId)
    if (operation.state === "downloaded") {
      throw new DownloadQueueOperationError(
        "已完成影音請從影片卡片刪除",
        "remove-not-allowed",
        409,
      )
    }
    if (PROCESS_ITEM_STATES.has(operation.state as DownloadQueueItemState)) {
      const active = this.active.get(item.id)
      if (!active) {
        throw new DownloadQueueOperationError(
          "下載程序不屬於目前服務，請等待狀態更新",
          "process-not-owned",
          409,
        )
      }
      this.termination.set(item.id, "remove")
      stopProcess(active.child)
      await active.completion
      item = this.item(itemId)
      operation = this.operation(item.operationId)
      if (operation.state === "downloaded") {
        throw new DownloadQueueOperationError(
          "影音已在停止前完成，請從影片卡片刪除",
          "remove-not-allowed",
          409,
        )
      }
    }
    this.pausedSessions.get(item.id)?.dispose()
    this.pausedSessions.delete(item.id)
    const job = item.videoId
      ? this.jobs
          .list()
          .find((candidate) => candidate.videoId === item.videoId)
      : undefined
    const preservePublishedMedia = Boolean(job?.watchable)
    this.db.transaction((transaction) => {
      transaction
        .delete(downloadQueueItems)
        .where(eq(downloadQueueItems.id, item.id))
        .run()
      transaction.delete(operations).where(eq(operations.id, item.operationId)).run()
      if (item.videoId && !preservePublishedMedia) {
        transaction.delete(jobs).where(eq(jobs.videoId, item.videoId)).run()
      }
    })
    this.removeUnfinishedFiles(item, preservePublishedMedia)
    this.schedule()
    return this.list()
  }
}
