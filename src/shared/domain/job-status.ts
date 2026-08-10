import type { JobSummary } from "@shared/contracts/job"

export const ACTIVE_STATES = new Set([
  "checking",
  "downloading",
  "transcribing",
  "proofreading",
  "translating",
  "segmenting",
  "preparing_player",
])

export const ATTENTION_STATES = new Set([
  "needs_transcription",
  "needs_proofreading",
  "needs_translation",
  "needs_segmentation",
  "interrupted",
  "failed",
])

export const JOB_STATE_LABELS: Record<string, string> = {
  queued: "等待處理",
  checking: "檢查來源",
  downloading: "下載中",
  downloaded: "下載完成",
  needs_transcription: "待轉錄",
  transcribing: "轉錄中",
  needs_proofreading: "待校正",
  proofreading: "校正中",
  needs_translation: "待翻譯",
  translating: "翻譯中",
  needs_segmentation: "待切分",
  segmenting: "切分中",
  preparing_player: "整理媒體",
  ready: "已完成",
  interrupted: "已中斷",
  failed: "處理失敗",
}

export const SUBTITLE_STAGE_LABELS: Record<string, string> = {
  awaiting_choice: "等待確認字幕需求",
  awaiting_model: "準備辨識語音",
  model_transcription: "正在辨識語音",
  content_revision: "正在整理字幕內容",
  content_complete: "字幕內容已完成",
  target_segmentation: "正在重新切分字幕",
  target_frozen: "字幕切分已確定",
  source_alignment: "正在同步字幕時間",
  validation: "正在檢查字幕",
  complete: "字幕已完成",
}

export type JobPhase =
  | "尚未開始"
  | "影音處理中"
  | "影音已完成"
  | "字幕處理中"
  | "字幕已完成"
  | string

export function phaseForJob(job: JobSummary): JobPhase {
  const current = job.effectiveState || job.state
  const pipelineStage = job.subtitlePipeline?.stage

  if (pipelineStage && SUBTITLE_STAGE_LABELS[pipelineStage]) {
    return SUBTITLE_STAGE_LABELS[pipelineStage]
  }
  if (
    [
      "transcribing",
      "proofreading",
      "translating",
      "segmenting",
      "needs_transcription",
      "needs_proofreading",
      "needs_translation",
      "needs_segmentation",
    ].includes(current)
  ) {
    return "字幕處理中"
  }
  if (current === "ready" && job.captionCodes.length > 0) {
    return "字幕已完成"
  }
  if (job.watchable || current === "downloaded") return "影音已完成"
  if (
    [
      "checking",
      "downloading",
      "preparing_player",
      "interrupted",
      "failed",
    ].includes(current)
  ) {
    return "影音處理中"
  }
  return "尚未開始"
}

export function statusTone(job: JobSummary) {
  const current = job.effectiveState || job.state
  if (ACTIVE_STATES.has(current)) return "active" as const
  if (current === "ready") return "ready" as const
  if (current === "failed") return "failed" as const
  if (ATTENTION_STATES.has(current)) return "attention" as const
  return "neutral" as const
}

export function subtitlePipelineLabel(job: JobSummary) {
  const pipeline = job.subtitlePipeline
  if (pipeline) {
    const label =
      SUBTITLE_STAGE_LABELS[pipeline.stage ?? ""] ??
      pipeline.stage ??
      "尚未開始"
    let detail = ""
    const processor =
      ["target_segmentation", "target_frozen", "source_alignment", "validation", "complete"].includes(
        pipeline.stage,
      )
        ? pipeline.segmentationProcessor
        : ["content_revision", "content_complete"].includes(pipeline.stage)
          ? pipeline.contentProcessor
          : pipeline.timingProcessor
    if (processor) {
      const provider =
        processor.provider === "local"
          ? "本機"
          : processor.provider === "openai"
            ? "OpenAI API"
            : "Agent"
      const identity = processor.model ?? processor.service
      detail = identity ? `${provider} · ${identity}` : provider
    }
    return { label, detail }
  }
  if (job.transcription) {
    const provider =
      job.transcription.provider === "local" ? "本機" : "OpenAI API"
    return {
      label: "模型轉錄",
      detail: `${provider} · ${job.transcription.model || "—"}`,
    }
  }
  return { label: "尚未開始", detail: "" }
}
