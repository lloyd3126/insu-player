import type {
  AgentProcessorIdentity,
  TimingProcessorIdentity,
} from "@shared/contracts/processor"

export const JOB_STATES = [
  "queued",
  "checking",
  "downloading",
  "downloaded",
  "needs_transcription",
  "transcribing",
  "needs_proofreading",
  "proofreading",
  "needs_translation",
  "translating",
  "needs_segmentation",
  "segmenting",
  "preparing_player",
  "ready",
  "interrupted",
  "failed",
] as const

export type JobState = (typeof JOB_STATES)[number]

export const SUBTITLE_PIPELINE_STAGES = [
  "awaiting_choice",
  "awaiting_model",
  "model_transcription",
  "content_revision",
  "content_complete",
  "target_segmentation",
  "target_frozen",
  "source_alignment",
  "validation",
  "complete",
] as const

export type SubtitlePipelineStage =
  (typeof SUBTITLE_PIPELINE_STAGES)[number]

export interface PlaybackState {
  time: number
  duration: number | null
  captionLanguage?: string | null
  updatedAt: string | null
}

export interface SubtitlePipeline {
  mode: "proofread" | "translate"
  stage: SubtitlePipelineStage
  sourceLanguage: string
  outputLanguage: string
  timingProcessor?: TimingProcessorIdentity
  contentProcessor?: AgentProcessorIdentity
  segmentationProcessor?: AgentProcessorIdentity
  manualReferenceArtifactIds: string[]
  updatedAt: string
}

export interface TranscriptionSummary {
  provider: TimingProcessorIdentity["provider"]
  service: string
  model: string | null
  languageTag: string
  engineLanguage: string | null
  updatedAt: string
}

export interface JobHistoryEntry {
  sequence: number
  at: string
  state: JobState
  stage: string
  message: string
}

export interface JobSummary {
  videoId: string
  title: string
  sourceUrl: string
  sourceKind: "page" | "embed" | "network-media"
  state: JobState
  effectiveState: JobState
  stage: string
  progress: number
  message: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  lastError: string | null
  watchable: boolean
  captionCodes: string[]
  activeSubtitleKinds: Record<
    string,
    "source" | "proofread" | "translation" | "segmentation"
  >
  activeSubtitleVersions: Record<string, string>
  subtitlePipeline: SubtitlePipeline | null
  transcription: TranscriptionSummary | null
  sizeBytes: number
  thumbnailUrl: string | null
  watchUrl: string | null
  hasLog: boolean
  durationSeconds: number | null
  activeMedia: {
    id: string
    width: number
    height: number
    container: string
    videoCodec: string | null
    audioCodec: string | null
    sizeBytes: number
    checksum: string
  } | null
  renditionCount: number
  mediaRevision: number
  playback: PlaybackState
}

export interface JobDetail extends JobSummary {
  history: JobHistoryEntry[]
  assets: Record<string, unknown>
}

export interface JobsResponse {
  jobs: JobSummary[]
  serverTime: string
}

export interface JobLogResponse {
  videoId: string
  log: string
}
