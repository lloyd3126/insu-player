import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import type { JobDetail } from "@shared/contracts/job"

export type SubtitleView = "source" | "translated"

function existingCode(
  available: Set<string>,
  preferred: string | null | undefined,
) {
  return preferred && available.has(preferred) ? preferred : null
}

export function selectCaptionView(
  comparison: CaptionComparisonResponse,
  job: JobDetail,
  view: SubtitleView,
) {
  const available = new Set(comparison.tracks.map((track) => track.code))
  const sourceCode =
    existingCode(available, job.subtitleWorkflow?.sourceLanguage) ??
    existingCode(available, comparison.baselineLanguage) ??
    comparison.tracks[0]?.code ??
    null
  const translatedCode =
    existingCode(available, job.subtitleWorkflow?.targetLanguage) ??
    (sourceCode !== "zh-TW" ? existingCode(available, "zh-TW") : null)
  const codes =
    view === "source"
      ? sourceCode
        ? [sourceCode]
        : []
      : translatedCode && translatedCode !== sourceCode
        ? [translatedCode]
        : []
  const selectedCodes = new Set(codes)

  return {
    codes,
    comparison: {
      ...comparison,
      baselineLanguage: comparison.baselineLanguage ?? sourceCode,
      tracks: comparison.tracks.filter((track) => selectedCodes.has(track.code)),
      rows: comparison.rows.map((row) => ({
        ...row,
        cues: Object.fromEntries(
          codes.map((code) => [code, row.cues[code] ?? ""]),
        ),
      })),
    },
  }
}
