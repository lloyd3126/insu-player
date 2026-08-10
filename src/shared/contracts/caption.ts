export interface CaptionCue {
  start: number
  end: number
  text: string
}

export interface CaptionTrack {
  id: string
  code: string
  label: string
  cueCount: number
}

export interface CaptionComparisonRow {
  id: string
  start: number
  end: number
  cues: Record<string, string>
}

export interface CaptionComparisonResponse {
  videoId: string
  baselineTrackId: string | null
  tracks: CaptionTrack[]
  rows: CaptionComparisonRow[]
}
