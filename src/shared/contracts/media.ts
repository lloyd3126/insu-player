export const MEDIA_OPERATION_STATES = [
  "discovering",
  "probing",
  "downloading",
  "merging",
  "validating",
  "ready",
  "failed",
  "interrupted",
] as const

export type MediaOperationState = (typeof MEDIA_OPERATION_STATES)[number]

export interface MediaSourceFormat {
  height: number
  width: number | null
  fps: number | null
  container: string
  videoCodec: string | null
  estimatedBytes: number | null
}

export interface MediaRendition {
  id: string
  requestedHeight: number
  width: number
  height: number
  container: string
  videoCodec: string | null
  audioCodec: string | null
  sizeBytes: number
  checksum: string
  createdAt: string
  active: boolean
}

export interface MediaOperation {
  id: string
  requestedHeight: number | null
  state: MediaOperationState
  stage: string
  progress: number
  message: string
  error: string | null
  pid: number | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MediaCatalogResponse {
  schemaVersion: 1
  videoId: string
  revision: number
  activeRenditionId: string | null
  availableBytes: number | null
  sourceRefreshedAt: string | null
  formats: MediaSourceFormat[]
  renditions: MediaRendition[]
  operation: MediaOperation | null
}

export interface MediaDownloadResponse {
  accepted: true
  operation: MediaOperation
}
