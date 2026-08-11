export const DOWNLOAD_BATCH_ITEM_STATES = [
  "checking",
  "queued",
  "downloading",
  "verifying",
  "downloaded",
  "needs_confirmation",
  "cancelled",
  "failed",
] as const

export type DownloadBatchItemState =
  (typeof DOWNLOAD_BATCH_ITEM_STATES)[number]

export const DOWNLOAD_SOURCE_KINDS = ["page", "embed", "network-media"] as const

export type DownloadSourceKind = (typeof DOWNLOAD_SOURCE_KINDS)[number]

export interface DownloadSourceInput {
  kind: DownloadSourceKind
  pageUrl: string
  sessionId?: string
  candidateFingerprint?: string
}

export interface CreateDownloadBatchRequest {
  sources: DownloadSourceInput[]
  rightsConfirmed: true
}

export interface DownloadBatchItem {
  id: string
  ordinal: number
  sourceKind: DownloadSourceKind
  pageUrl: string
  sourceUrl: string
  operationId: string
  videoId: string | null
  state: DownloadBatchItemState
  progress: number
  message: string
  errorCode: string | null
  lowQualityApproved: boolean
  authentication: "none" | "browser-session"
  authenticationConsentAt: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface DownloadBatch {
  id: string
  state: "active" | "paused" | "complete"
  rightsConfirmed: true
  createdAt: string
  updatedAt: string
  items: DownloadBatchItem[]
}

export interface DownloadBatchListResponse {
  batches: DownloadBatch[]
}

export interface CreateDownloadBatchResponse {
  accepted: true
  batch: DownloadBatch
}
