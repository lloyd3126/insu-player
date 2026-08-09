import { readFileSync } from "node:fs"

import type { JobRepository } from "@server/repositories/job-repository"
import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import { alignCaptionTracks, parseWebVtt } from "@shared/domain/subtitle"

const LABELS: Record<string, string> = {
  "zh-TW": "繁體中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  source: "原文",
}

export class CaptionService {
  constructor(private readonly jobs: JobRepository) {}

  comparison(videoId: string): CaptionComparisonResponse {
    const tracks = [...this.jobs.captionPaths(videoId)].map(([code, candidate]) => {
      const cues = parseWebVtt(readFileSync(candidate, "utf8"))
      return { code, cues }
    })
    const aligned = alignCaptionTracks(tracks)
    return {
      videoId,
      baselineLanguage: aligned.baselineLanguage,
      tracks: tracks.map((track) => ({
        code: track.code,
        label: LABELS[track.code] ?? track.code,
        cueCount: track.cues.length,
      })),
      rows: aligned.rows,
    }
  }
}
