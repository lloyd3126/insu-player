import type { JobSummary } from "@shared/contracts/job"

export const ACTIVE_STATES = new Set([
  "checking",
  "downloading",
  "transcribing",
  "translating",
  "preparing_player",
])

export const ATTENTION_STATES = new Set([
  "needs_transcription",
  "needs_translation",
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
  needs_translation: "待翻譯",
  translating: "翻譯中",
  preparing_player: "整理媒體",
  ready: "已完成",
  interrupted: "已中斷",
  failed: "處理失敗",
}

export const SUBTITLE_STAGE_LABELS: Record<string, string> = {
  awaiting_model: "等待模型轉錄",
  model_transcription: "模型詞級轉錄",
  source_caption: "來源字幕",
  draft_translation: "初次翻譯",
  sentence_polish: "完整句潤色",
  translation_complete: "完整句翻譯完成",
  target_segmentation: "目標語字幕切分",
  target_frozen: "目標語切分已固定",
  source_alignment: "來源時間對齊",
  segmentation_validation: "字幕切分驗證",
  segmentation_complete: "字幕切分完成",
  subtitle_reflow: "字幕重排",
  pair_validation: "雙語成對驗證",
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
  const workflowStage = job.subtitleWorkflow?.stage

  if (workflowStage === "source_caption") return "字幕已完成"
  if (workflowStage && SUBTITLE_STAGE_LABELS[workflowStage]) {
    return SUBTITLE_STAGE_LABELS[workflowStage]
  }
  if (
    [
      "transcribing",
      "translating",
      "needs_transcription",
      "needs_translation",
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

export function subtitleWorkflowLabel(job: JobSummary) {
  const workflow = job.subtitleWorkflow
  if (workflow) {
    const label =
      SUBTITLE_STAGE_LABELS[workflow.stage ?? ""] ??
      workflow.stage ??
      "尚未開始"
    let detail = ""
    if (workflow.provider) {
      const provider =
        workflow.provider === "local"
          ? "本機"
          : workflow.provider === "openai"
            ? "OpenAI API"
            : workflow.provider
      detail = workflow.model ? `${provider} · ${workflow.model}` : provider
    } else if (workflow.source === "platform") {
      detail = "來源平台"
    } else if (workflow.source === "model") {
      detail = "本機或 雲端模型"
    } else if (workflow.source === "legacy") {
      detail = "舊版工作流程"
    }
    return { label, detail }
  }

  const sources = Object.values(job.subtitleTracks).map((track) =>
    String(track.source ?? ""),
  )
  if (sources.some((source) => /reflow|resegment/i.test(source))) {
    return { label: "重排完成", detail: "雙語共用同步時間軸" }
  }
  if (job.transcription) {
    const provider =
      job.transcription.provider === "local" ? "本機" : "OpenAI API"
    return {
      label: "模型轉錄",
      detail: `${provider} · ${job.transcription.model || "—"}`,
    }
  }
  if (job.captionCodes.length > 0) {
    return { label: "來源字幕", detail: "舊版工作紀錄" }
  }
  return { label: "尚未開始", detail: "" }
}
