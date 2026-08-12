import type { JobSummary } from "@shared/contracts/job"

export const NO_CAPTION = "none"

export function getPreferredCaption(
  codes: string[],
  fallback = NO_CAPTION,
  preferred: Array<string | null | undefined> = [],
) {
  const available = new Set(codes)
  const selected = preferred.find(
    (language): language is string =>
      typeof language === "string" && available.has(language),
  )
  if (selected) return selected
  return codes[0] ?? fallback
}

export function getJobPreferredCaption(
  job: JobSummary,
  fallback = NO_CAPTION,
) {
  return getPreferredCaption(job.captionCodes, fallback, [
    job.playback.captionLanguage,
    job.subtitlePipeline?.outputLanguage,
    job.subtitlePipeline?.sourceLanguage,
  ])
}
