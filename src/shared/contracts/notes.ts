export interface VideoNote {
  id: string
  videoId: string
  title: string
  body: string
  startSeconds: number | null
  endSeconds: number | null
  subtitleTrackId: string | null
  subtitleCueId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface VideoNotesResponse {
  videoId: string
  notes: VideoNote[]
}

export interface SaveVideoNoteRequest {
  title: string
  body: string
  startSeconds?: number | null
  endSeconds?: number | null
  subtitleTrackId?: string | null
  subtitleCueId?: string | null
  tags?: string[]
}
