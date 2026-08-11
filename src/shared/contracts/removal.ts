export interface VideoRemovalTarget {
  kind: "video"
  videoId: string
}

export interface SubtitleArtifactRemovalTarget {
  kind: "subtitle-artifact"
  videoId: string
  artifactId: string
}

export interface MediaRenditionRemovalTarget {
  kind: "media-rendition"
  videoId: string
  renditionId: string
}

export interface SummaryArtifactRemovalTarget {
  kind: "summary-artifact"
  videoId: string
  artifactId: string
}

export type RemovalTarget =
  | VideoRemovalTarget
  | SubtitleArtifactRemovalTarget
  | MediaRenditionRemovalTarget
  | SummaryArtifactRemovalTarget

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
