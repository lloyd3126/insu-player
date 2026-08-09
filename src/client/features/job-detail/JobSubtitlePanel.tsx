import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { CaptionComparisonTable } from "@/features/job-detail/CaptionComparisonTable"
import { JobFact, JobFactGrid } from "@/features/job-detail/JobFactGrid"
import {
  selectCaptionView,
  type SubtitleView,
} from "@/features/job-detail/subtitle-view"
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

function knownCodes(job: JobDetail, view: SubtitleView) {
  const preferred =
    view === "source"
      ? job.subtitleWorkflow?.sourceLanguage
      : job.subtitleWorkflow?.targetLanguage
  if (preferred && job.captionCodes.includes(preferred)) return [preferred]
  if (view === "source") {
    if (job.captionCodes.includes("en")) return ["en"]
    return job.captionCodes[0] ? [job.captionCodes[0]] : []
  }
  return job.captionCodes.includes("zh-TW") ? ["zh-TW"] : []
}

function sourceMethod(job: JobDetail) {
  if (job.subtitleWorkflow?.source === "platform") return "yt-dlp 來源字幕"
  if (job.subtitleWorkflow?.source === "model") {
    if (job.subtitleWorkflow.provider === "local") return "本機模型轉錄"
    if (job.subtitleWorkflow.provider === "openai") return "雲端模型轉錄"
    return "模型轉錄"
  }
  if (job.subtitleWorkflow?.source === "legacy") return "舊版工作流程"
  return "尚未記錄"
}

export function JobSubtitlePanel({
  job,
  view,
}: {
  job: JobDetail
  view: SubtitleView
}) {
  const captions = useJobCaptions(job.videoId)
  const workflow = subtitleWorkflowLabel(job)
  const selection = captions.data
    ? selectCaptionView(captions.data, job, view)
    : null
  const codes = selection?.codes ?? knownCodes(job, view)
  const isSource = view === "source"

  return (
    <div className="job-subtitle-content">
      <JobFactGrid className="job-facts--subtitle">
        <JobFact label={isSource ? "原始字幕" : "翻譯字幕"}>
          <LanguageCodeList codes={codes} />
        </JobFact>
        {isSource ? (
          <>
            <JobFact label="轉錄模型">{transcriptionLabel(job)}</JobFact>
            <JobFact label="產生方式">{sourceMethod(job)}</JobFact>
          </>
        ) : (
          <>
            <JobFact label="翻譯模型">
              {workflow.detail || "尚未記錄"}
            </JobFact>
            <JobFact label="字幕流程">{workflow.label}</JobFact>
          </>
        )}
      </JobFactGrid>
      {captions.isPending ? (
        <LoadingState
          label={isSource ? "正在準備原始字幕" : "正在準備翻譯字幕"}
        />
      ) : null}
      {captions.isError ? (
        <ErrorState message={captions.error.message} />
      ) : null}
      {selection ? (
        <CaptionComparisonTable
          comparison={selection.comparison}
          kicker={isSource ? "SOURCE TIMELINE" : "TRANSLATED TIMELINE"}
          title={isSource ? "原始字幕" : "翻譯字幕"}
          emptyTitle={isSource ? "尚無原始字幕" : "尚無翻譯字幕"}
          emptyDescription={
            isSource
              ? "這支影音目前沒有可顯示的原始字幕軌。"
              : "這支影音目前沒有可顯示的翻譯字幕軌。"
          }
        />
      ) : null}
    </div>
  )
}
