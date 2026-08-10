import { readFileSync } from "node:fs"

import type { JobRepository } from "@server/repositories/job-repository"
import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import type { SubtitleArtifactComparisonResponse } from "@shared/contracts/subtitle-catalog"
import { alignCaptionTracks, parseWebVtt } from "@shared/domain/subtitle"

export class CaptionService {
  constructor(private readonly jobs: JobRepository) {}

  private comparisonFromPaths(
    videoId: string,
    paths: Array<{ id: string; code: string; label: string; path: string }>,
  ): CaptionComparisonResponse {
    const tracks = paths.map(({ id, code, label, path }) => {
      const cues = parseWebVtt(readFileSync(path, "utf8"))
      return { id, code, label, cues }
    })
    const aligned = alignCaptionTracks(tracks)
    return {
      videoId,
      baselineTrackId: aligned.baselineTrackId,
      tracks: tracks.map((track) => ({
        id: track.id,
        code: track.code,
        label: track.label,
        cueCount: track.cues.length,
      })),
      rows: aligned.rows,
    }
  }

  comparison(videoId: string): CaptionComparisonResponse {
    return this.comparisonFromPaths(videoId, this.jobs.activeCaptionPaths(videoId))
  }

  artifactComparison(
    videoId: string,
    artifactId: string,
  ): SubtitleArtifactComparisonResponse {
    const catalog = this.jobs.subtitleCatalog(videoId)
    const artifact = catalog.artifacts.find(
      (candidate) => candidate.id === artifactId,
    )
    if (!artifact) throw new Error("subtitle artifact not found")
    return {
      ...this.comparisonFromPaths(
        videoId,
        this.jobs.artifactCaptionPaths(videoId, artifactId),
      ),
      artifact,
    }
  }
}
