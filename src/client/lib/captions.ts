import type { JobSummary } from "@shared/contracts/job"

export const NO_CAPTION = "none"

export function getPreferredCaption(
  codes: string[],
  fallback = NO_CAPTION,
  preferred: Array<string | null | undefined> = [],
) {
  const selected = preferred.find(
    (language): language is string =>
      typeof language === "string" && codes.includes(language),
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
