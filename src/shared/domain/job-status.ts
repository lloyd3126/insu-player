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
  awaiting_choice: "等待選擇字幕流程",
  awaiting_model: "等待模型轉錄",
  model_transcription: "模型詞級轉錄",
  content_revision: "完整句內容處理",
  content_complete: "完整句內容完成",
  target_segmentation: "目標語字幕切分",
  target_frozen: "目標語切分已固定",
  source_alignment: "來源時間對齊",
  validation: "字幕產物驗證",
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
    const providerValue = pipeline.contentProvider ?? pipeline.timingProvider
    const model = pipeline.contentModel ?? pipeline.timingModel
    if (providerValue) {
      const provider =
        providerValue === "local"
          ? "本機"
          : providerValue === "openai"
            ? "OpenAI API"
            : providerValue
      detail = model ? `${provider} · ${model}` : provider
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
