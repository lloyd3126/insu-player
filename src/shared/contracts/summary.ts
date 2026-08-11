export const SUMMARY_ARTIFACT_KINDS = ["text", "mindmap"] as const

export type SummaryArtifactKind = (typeof SUMMARY_ARTIFACT_KINDS)[number]

export interface SummaryDependency {
  type: "subtitle" | "summary"
  id: string
}

export interface SummaryArtifact {
  id: string
  videoId: string
  kind: SummaryArtifactKind
  revision: number
  languageCode: string
  title: string
  processor: {
    provider: "agent"
    service: "codex"
  }
  checksum: string
  validationState: "valid"
  createdAt: string
  active: boolean
  dependencies: SummaryDependency[]
}

export interface SummaryCatalogResponse {
  schemaVersion: 1
  videoId: string
  artifacts: SummaryArtifact[]
  activeArtifactIds: Partial<Record<SummaryArtifactKind, string>>
}

export interface SummaryArtifactResponse {
  artifact: SummaryArtifact
  content: string
}

export interface SummaryImportRequest {
  kind: SummaryArtifactKind
  languageCode: string
  title: string
  content: string
  sourceSubtitleArtifactId?: string
  sourceSummaryArtifactId?: string
}
