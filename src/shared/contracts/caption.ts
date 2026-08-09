export interface CaptionCue {
  start: number
  end: number
  text: string
}

export interface CaptionTrack {
  code: string
  label: string
  cueCount: number
}

export interface CaptionComparisonRow {
  start: number
  end: number
  cues: Record<string, string>
}

export interface CaptionComparisonResponse {
  videoId: string
  baselineLanguage: string | null
  tracks: CaptionTrack[]
  rows: CaptionComparisonRow[]
}
