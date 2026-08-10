import { existsSync, lstatSync, readFileSync, statfsSync, statSync } from "node:fs"
import path from "node:path"

import { atomicWriteJson, safeContainedFile } from "@server/lib/files"
import type {
  MediaCatalogResponse,
  MediaOperation,
  MediaRendition,
  MediaSourceFormat,
} from "@shared/contracts/media"

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const RENDITION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const ACTIVE_OPERATION_STATES = new Set([
  "discovering",
  "probing",
  "downloading",
  "merging",
  "validating",
])
const OPERATION_HEARTBEAT_GRACE_MS = 15_000

interface StoredMediaRendition extends Omit<MediaRendition, "active"> {
  path: string
  formatId: string | null
  selection: string | null
}

interface StoredMediaCatalog {
  schemaVersion: 1
  videoId: string
  revision: number
  activeRenditionId: string | null
  availability: {
    discoveredAt: string | null
    formats: MediaSourceFormat[]
  }
  renditions: StoredMediaRendition[]
  operation: MediaOperation | null
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null
}

function nullablePositiveInteger(value: unknown) {
  return value === null ? null : positiveInteger(value)
}

function nullableFiniteNumber(value: unknown) {
  return value === null
    ? null
    : typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
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

function operationHeartbeatExpired(updatedAt: string) {
  const timestamp = Date.parse(updatedAt)
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp > OPERATION_HEARTBEAT_GRACE_MS
  )
}

function safeRelativePath(value: unknown) {
  if (typeof value !== "string" || path.isAbsolute(value)) return null
  const parts = value.split(/[\\/]+/)
  if (
    parts.length !== 3 ||
    parts[0] !== "source" ||
    parts[1] !== "renditions" ||
    parts.includes("..")
  ) {
    return null
  }
  return parts.join(path.sep)
}

function parseFormat(value: unknown): MediaSourceFormat | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Record<string, unknown>
  const height = positiveInteger(candidate.height)
  if (!height || candidate.container !== "mp4") return null
  const width = nullablePositiveInteger(candidate.width)
  const fps = nullableFiniteNumber(candidate.fps)
  const estimatedBytes = nullablePositiveInteger(candidate.estimatedBytes)
  if (
    (candidate.width !== null && !width) ||
    (candidate.fps !== null && !fps) ||
    (candidate.estimatedBytes !== null && !estimatedBytes) ||
    (candidate.videoCodec !== null && typeof candidate.videoCodec !== "string")
  ) {
    return null
  }
  return {
    height,
    width,
    fps,
    estimatedBytes,
    container: "mp4",
    videoCodec: candidate.videoCodec as string | null,
  }
}

function parseOperation(value: unknown): MediaOperation | null {
  if (value === null) return null
  if (!value || typeof value !== "object") throw new Error("media operation is invalid")
  const candidate = value as Record<string, unknown>
  const state = String(candidate.state)
  if (
    ![
      "discovering",
      "probing",
      "downloading",
      "merging",
      "validating",
      "ready",
      "failed",
      "interrupted",
    ].includes(state)
  ) {
    throw new Error("media operation state is invalid")
  }
  const progress = Number(candidate.progress)
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error("media operation progress is invalid")
  }
  if (
    typeof candidate.id !== "string" ||
    !RENDITION_ID_PATTERN.test(candidate.id) ||
    typeof candidate.stage !== "string" ||
    typeof candidate.message !== "string" ||
    !validTimestamp(candidate.startedAt) ||
    !validTimestamp(candidate.updatedAt)
  ) {
    throw new Error("media operation fields are invalid")
  }
  if (
    (candidate.error !== null && typeof candidate.error !== "string") ||
    (candidate.completedAt !== null && !validTimestamp(candidate.completedAt))
  ) {
    throw new Error("media operation nullable fields are invalid")
  }
  const requestedHeight =
    candidate.requestedHeight === null
      ? null
      : positiveInteger(candidate.requestedHeight)
  const pid = candidate.pid === null ? null : positiveInteger(candidate.pid)
  if (
    (candidate.requestedHeight !== null && !requestedHeight) ||
    (candidate.pid !== null && !pid)
  ) {
    throw new Error("media operation numeric fields are invalid")
  }
  return {
    id: candidate.id,
    requestedHeight,
    state: state as MediaOperation["state"],
    stage: candidate.stage,
    progress,
    message: candidate.message,
    error: candidate.error as string | null,
    pid,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    completedAt: candidate.completedAt as string | null,
  }
}

export function mediaCatalogPath(jobDirectory: string) {
  return path.join(jobDirectory, "media-work", "catalog.json")
}

export function readStoredMediaCatalog(
  jobDirectory: string,
  videoId: string,
): StoredMediaCatalog {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("invalid video ID")
  const candidate = mediaCatalogPath(jobDirectory)
  if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) {
    throw new Error("media catalog not found")
  }
  const payload = JSON.parse(readFileSync(candidate, "utf8")) as Record<
    string,
    unknown
  >
  if (payload.schemaVersion !== 1 || payload.videoId !== videoId) {
    throw new Error("media catalog identity is invalid")
  }
  const revision = Number(payload.revision)
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("media catalog revision is invalid")
  }
  const availability = payload.availability
  if (!availability || typeof availability !== "object") {
    throw new Error("media catalog availability is invalid")
  }
  const rawFormats = (availability as Record<string, unknown>).formats
  const discoveredAt = (availability as Record<string, unknown>).discoveredAt
  if (discoveredAt !== null && !validTimestamp(discoveredAt)) {
    throw new Error("media catalog discoveredAt is invalid")
  }
  if (!Array.isArray(rawFormats)) throw new Error("media formats are invalid")
  const formats = rawFormats.map(parseFormat)
  if (formats.some((format) => !format)) throw new Error("media format is invalid")

  if (!Array.isArray(payload.renditions)) {
    throw new Error("media catalog renditions are invalid")
  }
  const ids = new Set<string>()
  const renditions = payload.renditions.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("media rendition is invalid")
    const rendition = raw as Record<string, unknown>
    const id = typeof rendition.id === "string" ? rendition.id : ""
    const relativePath = safeRelativePath(rendition.path)
    const requestedHeight = positiveInteger(rendition.requestedHeight)
    const width = positiveInteger(rendition.width)
    const height = positiveInteger(rendition.height)
    const sizeBytes = positiveInteger(rendition.sizeBytes)
    const checksum = typeof rendition.checksum === "string" ? rendition.checksum : ""
    if (
      !RENDITION_ID_PATTERN.test(id) ||
      ids.has(id) ||
      !relativePath ||
      !requestedHeight ||
      !width ||
      !height ||
      !sizeBytes ||
      !CHECKSUM_PATTERN.test(checksum) ||
      !validTimestamp(rendition.createdAt) ||
      rendition.container !== "mp4" ||
      (rendition.videoCodec !== null && typeof rendition.videoCodec !== "string") ||
      (rendition.audioCodec !== null && typeof rendition.audioCodec !== "string") ||
      (rendition.formatId !== null && typeof rendition.formatId !== "string") ||
      (rendition.selection !== null && typeof rendition.selection !== "string")
    ) {
      throw new Error("media rendition fields are invalid")
    }
    ids.add(id)
    const file = safeContainedFile(jobDirectory, path.join(jobDirectory, relativePath))
    if (!file || statSync(file).size !== sizeBytes) {
      throw new Error(`media rendition file is unavailable: ${id}`)
    }
    return {
      id,
      requestedHeight,
      width,
      height,
      container: "mp4",
      videoCodec: rendition.videoCodec as string | null,
      audioCodec: rendition.audioCodec as string | null,
      sizeBytes,
      checksum,
      createdAt: rendition.createdAt,
      path: relativePath,
      formatId: rendition.formatId as string | null,
      selection: rendition.selection as string | null,
    }
  })
  const activeRenditionId =
    typeof payload.activeRenditionId === "string"
      ? payload.activeRenditionId
      : null
  if (!activeRenditionId || !ids.has(activeRenditionId)) {
    throw new Error("media catalog has no active rendition")
  }
  return {
    schemaVersion: 1,
    videoId,
    revision,
    activeRenditionId,
    availability: {
      discoveredAt: discoveredAt as string | null,
      formats: formats as MediaSourceFormat[],
    },
    renditions,
    operation: parseOperation(payload.operation),
  }
}

export function publicMediaCatalog(
  jobDirectory: string,
  videoId: string,
): MediaCatalogResponse {
  const stored = readStoredMediaCatalog(jobDirectory, videoId)
  let operation = stored.operation
  let availableBytes: number | null = null
  try {
    const filesystem = statfsSync(jobDirectory)
    availableBytes = Math.max(0, filesystem.bavail * filesystem.bsize)
  } catch {
    availableBytes = null
  }
  if (
    operation &&
    ACTIVE_OPERATION_STATES.has(operation.state) &&
    operationHeartbeatExpired(operation.updatedAt) &&
    !processIsAlive(operation.pid)
  ) {
    operation = {
      ...operation,
      state: "interrupted",
      stage: "interrupted",
      message: "畫質下載程序已停止，可重新嘗試",
      error: operation.error ?? "media process is no longer running",
      pid: null,
      completedAt: operation.updatedAt,
    }
  }
  return {
    schemaVersion: 1,
    videoId,
    revision: stored.revision,
    activeRenditionId: stored.activeRenditionId,
    availableBytes,
    sourceRefreshedAt: stored.availability.discoveredAt,
    formats: stored.availability.formats,
    renditions: stored.renditions.map((rendition) => ({
      id: rendition.id,
      requestedHeight: rendition.requestedHeight,
      width: rendition.width,
      height: rendition.height,
      container: rendition.container,
      videoCodec: rendition.videoCodec,
      audioCodec: rendition.audioCodec,
      sizeBytes: rendition.sizeBytes,
      checksum: rendition.checksum,
      createdAt: rendition.createdAt,
      active: rendition.id === stored.activeRenditionId,
    })),
    operation,
  }
}

export function activeMediaPath(jobDirectory: string, videoId: string) {
  const candidate = mediaCatalogPath(jobDirectory)
  if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) return null
  const catalog = readStoredMediaCatalog(jobDirectory, videoId)
  const active = catalog.renditions.find(
    (rendition) => rendition.id === catalog.activeRenditionId,
  )
  if (!active) throw new Error("media catalog active rendition is unavailable")
  return safeContainedFile(jobDirectory, path.join(jobDirectory, active.path))
}

export function setActiveMediaRendition(
  jobDirectory: string,
  videoId: string,
  renditionId: string,
) {
  if (!RENDITION_ID_PATTERN.test(renditionId)) {
    throw new Error("invalid rendition ID")
  }
  const catalog = readStoredMediaCatalog(jobDirectory, videoId)
  if (!catalog.renditions.some((rendition) => rendition.id === renditionId)) {
    throw new Error("media rendition not found")
  }
  catalog.activeRenditionId = renditionId
  catalog.revision += 1
  atomicWriteJson(mediaCatalogPath(jobDirectory), catalog)
  return publicMediaCatalog(jobDirectory, videoId)
}

export function writeMediaOperation(
  jobDirectory: string,
  videoId: string,
  operation: MediaOperation,
) {
  const catalog = readStoredMediaCatalog(jobDirectory, videoId)
  catalog.operation = operation
  catalog.revision += 1
  atomicWriteJson(mediaCatalogPath(jobDirectory), catalog)
}

export function mediaOperationIsActive(operation: MediaOperation | null) {
  return Boolean(
    operation &&
      ACTIVE_OPERATION_STATES.has(operation.state) &&
      processIsAlive(operation.pid),
  )
}
