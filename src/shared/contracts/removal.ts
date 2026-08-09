export interface VideoRemovalTarget {
  kind: "video"
  videoId: string
}

export type RemovalTarget = VideoRemovalTarget

export interface RemovalIssue {
  code: string
  message: string
}

export interface RemovalPreviewResponse {
  schemaVersion: 1
  target: RemovalTarget
  planDigest: string
  blocked: RemovalIssue[]
  warnings: RemovalIssue[]
}

export interface RemovalExecutionResponse {
  schemaVersion: 1
  target: RemovalTarget
  planDigest: string
  removed: true
}
