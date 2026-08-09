import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { CaptionComparisonTable } from "@/features/job-detail/CaptionComparisonTable"
import { JobFact, JobFactGrid } from "@/features/job-detail/JobFactGrid"
import { useJobCaptions } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import { subtitleWorkflowLabel } from "@shared/domain/job-status"

function transcriptionLabel(job: JobDetail) {
  if (!job.transcription) return "尚未使用"
  const provider =
    job.transcription.provider === "local"
      ? "本機"
      : job.transcription.provider === "openai"
        ? "OpenAI API"
        : job.transcription.provider
  return `${provider} · ${job.transcription.model}`
}

export function JobSubtitlePanel({ job }: { job: JobDetail }) {
  const captions = useJobCaptions(job.videoId)
  const workflow = subtitleWorkflowLabel(job)

  return (
    <div className="job-subtitle-content">
      <JobFactGrid className="job-facts--subtitle">
        <JobFact label="字幕">
          <LanguageCodeList codes={job.captionCodes} />
        </JobFact>
        <JobFact label="轉錄模型">{transcriptionLabel(job)}</JobFact>
        <JobFact label="字幕流程">
          {workflow.label}
          {workflow.detail ? ` · ${workflow.detail}` : ""}
        </JobFact>
      </JobFactGrid>
      {captions.isPending ? <LoadingState label="正在準備多語字幕對照" /> : null}
      {captions.isError ? (
        <ErrorState message={captions.error.message} />
      ) : null}
      {captions.data ? (
        <CaptionComparisonTable comparison={captions.data} />
      ) : null}
    </div>
  )
}
