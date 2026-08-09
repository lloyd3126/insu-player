export const JOB_STATES = [
  "queued",
  "checking",
  "downloading",
  "downloaded",
  "needs_transcription",
  "transcribing",
  "needs_translation",
  "translating",
  "preparing_player",
  "ready",
  "interrupted",
  "failed",
] as const

export type JobState = (typeof JOB_STATES)[number]

export const SUBTITLE_WORKFLOW_STAGES = [
  "awaiting_model",
  "model_transcription",
  "source_caption",
  "draft_translation",
  "sentence_polish",
  "subtitle_reflow",
  "pair_validation",
  "complete",
] as const

export type SubtitleWorkflowStage =
  (typeof SUBTITLE_WORKFLOW_STAGES)[number]

export interface PlaybackState {
  time: number
  duration: number | null
  updatedAt: string | null
}

export interface SubtitleTrackState {
  state?: string
  source?: string
  label?: string
  path?: string
  bytes?: number | null
  updatedAt?: string
}

export interface SubtitleWorkflow {
  stage?: SubtitleWorkflowStage | string
  source?: "model" | "platform" | "legacy" | string
  provider?: "local" | "openai" | string
  model?: string
  sourceLanguage?: string
  targetLanguage?: string
  updatedAt?: string
}

export interface TranscriptionSummary {
  provider: string
  model: string
}

export interface JobHistoryEntry {
  at?: string
  state?: JobState | string
  stage?: string
  message?: string
}

export interface JobSummary {
  videoId: string
  title: string
  sourceUrl: string
  state: JobState | string
  effectiveState: JobState | string
  stage: string
  progress: number
  message: string
  createdAt: string | null
  updatedAt: string | null
  completedAt: string | null
  lastError: string | null
  watchable: boolean
  captionCodes: string[]
  subtitleTracks: Record<string, SubtitleTrackState>
  subtitleWorkflow: SubtitleWorkflow | null
  transcription: TranscriptionSummary | null
  sizeBytes: number
  thumbnailUrl: string | null
  watchUrl: string | null
  hasLog: boolean
  durationSeconds: number | null
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
