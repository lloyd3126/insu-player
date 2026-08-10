import type { JobSummary } from "@shared/contracts/job"
import type { SubtitlePromptContext } from "@shared/prompts/insu-prompts"

export function jobPromptContext(job: JobSummary): SubtitlePromptContext {
  return {
    videoId: job.videoId,
    state: job.effectiveState || job.state,
    stage: job.stage,
    progress: job.progress,
    mode: job.subtitlePipeline?.mode,
    sourceLanguage: job.subtitlePipeline?.sourceLanguage,
    outputLanguage: job.subtitlePipeline?.outputLanguage,
    timingProcessor: job.subtitlePipeline?.timingProcessor,
    contentProcessor: job.subtitlePipeline?.contentProcessor,
    segmentationProcessor: job.subtitlePipeline?.segmentationProcessor,
  }
}
