import type { JobSummary } from "@shared/contracts/job"

export const DOWNLOAD_QUEUE_ITEM_STATES = [
  "checking",
  "queued",
  "downloading",
  "verifying",
  "paused",
  "downloaded",
  "needs_confirmation",
  "cancelled",
  "failed",
] as const

export type DownloadQueueItemState =
  (typeof DOWNLOAD_QUEUE_ITEM_STATES)[number]

export const DOWNLOAD_SOURCE_KINDS = ["page", "embed", "network-media"] as const

export type DownloadSourceKind = (typeof DOWNLOAD_SOURCE_KINDS)[number]

export interface DownloadSourceInput {
  kind: DownloadSourceKind
  pageUrl: string
  sessionId?: string
  candidateFingerprint?: string
}

export interface CreateLibraryItemsRequest {
  sources: DownloadSourceInput[]
  rightsConfirmed: true
}

export interface CreateLibraryItemsResponse {
  accepted: true
  itemIds: string[]
}

export interface DownloadLibraryItem {
  kind: "download"
  id: string
  sourceKind: DownloadSourceKind
  pageUrl: string
  sourceUrl: string
  videoId: string | null
  title: string
  thumbnailUrl: string | null
  state: DownloadQueueItemState
  stage: string
  progress: number
  message: string
  errorCode: string | null
  queueAhead: number | null
  lowQualityApproved: boolean
  authentication: "none" | "browser-session"
  authenticationConsentAt: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MediaLibraryItem {
  kind: "media"
  id: string
  job: JobSummary
}

export const LOCAL_MEDIA_IMPORT_STATES = [
  "awaiting_upload",
  "uploading",
  "probing",
  "transcoding",
  "finalizing",
  "ready",
  "cancelled",
  "failed",
] as const

export type LocalMediaImportState =
  (typeof LOCAL_MEDIA_IMPORT_STATES)[number]

export interface CreateLocalMediaImportRequest {
  originalName: string
  title: string
  sizeBytes: number
  contentType: string
  rightsConfirmed: true
}

export interface CreateLocalMediaImportResponse {
  importId: string
  uploadUrl: string
}

export interface ImportLibraryItem {
  kind: "import"
  id: string
  originalName: string
  title: string
  contentType: string
  sizeBytes: number
  uploadedBytes: number
  videoId: string | null
  state: LocalMediaImportState
  stage: string
  progress: number
  message: string
  errorCode: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type LibraryItem =
  | DownloadLibraryItem
  | ImportLibraryItem
  | MediaLibraryItem

export interface DownloadQueueSummary {
  paused: boolean
  concurrency: number
  queuedCount: number
  activeCount: number
  attentionCount: number
}

export interface LibraryResponse {
  items: LibraryItem[]
  queue: DownloadQueueSummary
  serverTime: string
}
