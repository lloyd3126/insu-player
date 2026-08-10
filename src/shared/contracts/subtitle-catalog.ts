import type { CaptionComparisonResponse } from "@shared/contracts/caption"

export const SUBTITLE_ARTIFACT_KINDS = [
  "source",
  "proofread",
  "translation",
  "segmentation",
] as const

export type SubtitleArtifactKind = (typeof SUBTITLE_ARTIFACT_KINDS)[number]

export const SUBTITLE_ARTIFACT_PROVIDERS = [
  "yt-dlp",
  "local",
  "openai",
] as const

export type SubtitleArtifactProvider =
  (typeof SUBTITLE_ARTIFACT_PROVIDERS)[number]

export const SUBTITLE_SOURCE_TYPES = [
  "manual-cc",
  "model-transcript",
] as const

export type SubtitleSourceType = (typeof SUBTITLE_SOURCE_TYPES)[number]

export const SUBTITLE_TIMING_UNIT_KINDS = [
  "cue",
  "word",
  "token",
  "grapheme-group",
] as const

export type SubtitleTimingUnitKind =
  (typeof SUBTITLE_TIMING_UNIT_KINDS)[number]

export const SUBTITLE_TRACK_ROLES = [
  "source_raw",
  "input_sentence",
  "output_sentence",
  "input_segmented",
  "output_segmented",
] as const

export type SubtitleTrackRole = (typeof SUBTITLE_TRACK_ROLES)[number]

export const SUBTITLE_DEPENDENCY_RELATIONS = [
  "timing-source",
  "text-reference",
  "content-parent",
] as const

export type SubtitleDependencyRelation =
  (typeof SUBTITLE_DEPENDENCY_RELATIONS)[number]

export type SubtitleLifecycleState =
  | "draft"
  | "processing"
  | "ready"
  | "failed"
  | "archived"

export type SubtitleValidationState =
  | "pending"
  | "valid"
  | "warning"
  | "invalid"

export type SubtitleFreshnessState = "current" | "stale" | "superseded"

export interface SubtitleArtifactDependency {
  artifactId: string
  relation: SubtitleDependencyRelation
}

export interface SubtitleArtifactTrack {
  id: string
  artifactId: string
  languageCode: string
  role: SubtitleTrackRole
  state: string
  playbackEligible: boolean
  sizeBytes: number | null
  cueCount: number
  checksum: string
  updatedAt: string | null
}

export interface SubtitleArtifact {
  id: string
  kind: SubtitleArtifactKind
  revision: number
  lifecycleState: SubtitleLifecycleState
  validationState: SubtitleValidationState
  freshnessState: SubtitleFreshnessState
  sourceLanguage: string
  outputLanguage: string | null
  sourceType: SubtitleSourceType | null
  provider: SubtitleArtifactProvider
  model: string | null
  timingUnitKind: SubtitleTimingUnitKind | null
  targetFrozen: boolean
  manifestAvailable: boolean
  checksum: string
  warningCount: number
  hardDefectCount: number
  dependencies: SubtitleArtifactDependency[]
  tracks: SubtitleArtifactTrack[]
  createdAt: string | null
  completedAt: string | null
}

export interface ActiveSubtitleTrack extends SubtitleArtifactTrack {
  artifactKind: SubtitleArtifactKind
  sourceType: SubtitleSourceType | null
  revision: number
  active: true
  reason: "explicit" | "resolver"
}

export interface SubtitlePlaybackOption extends SubtitleArtifactTrack {
  artifactKind: SubtitleArtifactKind
  sourceType: SubtitleSourceType | null
  revision: number
  label: string
  active: boolean
}

export interface SubtitlePlaybackLanguage {
  languageCode: string
  activeTrackId: string
  activeReason: "explicit" | "resolver"
  options: SubtitlePlaybackOption[]
}

export interface SubtitleCatalogResponse {
  videoId: string
  artifacts: SubtitleArtifact[]
  activeTracks: ActiveSubtitleTrack[]
  playbackLanguages: SubtitlePlaybackLanguage[]
  availableLanguageCodes: string[]
}

export interface SubtitleArtifactComparisonResponse
  extends CaptionComparisonResponse {
  artifact: SubtitleArtifact
}
