import type { JobSummary } from "@shared/contracts/job"
import { ACTIVE_STATES } from "@shared/domain/job-status"

export type JobNextActionPrompt = "subtitle" | "recovery" | null

export interface JobNextAction {
  kind:
    | "processing"
    | "complete"
    | "recover"
    | "segment"
    | "content"
    | "start"
  kicker: string
  title: string
  description: string
  prompt: JobNextActionPrompt
}

function activeSubtitleKinds(job: JobSummary) {
  return new Set(Object.values(job.activeSubtitleKinds))
}

export function nextActionForJob(job: JobSummary): JobNextAction {
  const state = job.effectiveState || job.state
  const kinds = activeSubtitleKinds(job)

  if (state === "interrupted" || state === "failed") {
    return {
      kind: "recover",
      kicker: "CONTINUE / WORKFLOW",
      title: state === "failed" ? "檢查並接續處理" : "接續中斷的工作",
      description:
        "複製目前狀態提示，Agent 會先檢查仍在運作的程序與已完成產物，再只接續缺少的階段。",
      prompt: "recovery",
    }
  }

  if (ACTIVE_STATES.has(state)) {
    return {
      kind: "processing",
      kicker: "WORKING / PLEASE WAIT",
      title: "目前正在處理",
      description:
        "不需要重複啟動工作。Agent 會持續追蹤，完成或需要你決定時再通知你。",
      prompt: null,
    }
  }

  if (
    job.watchable &&
    (job.subtitlePipeline?.stage === "complete" ||
      kinds.has("segmentation"))
  ) {
    return {
      kind: "complete",
      kicker: "READY / SUBTITLES",
      title: "字幕已完成",
      description:
        "可以在字幕管理的切分字幕中預覽版本，再到播放器選擇想看的字幕語言。",
      prompt: null,
    }
  }

  if (
    state === "needs_segmentation" ||
    kinds.has("translation") ||
    kinds.has("proofread")
  ) {
    return {
      kind: "segment",
      kicker: "NEXT / SEGMENT",
      title: "完成字幕切分",
      description:
        "完整句字幕已經存在。複製提示後，Agent 只會接續字幕切分、時間同步與驗證。",
      prompt: "subtitle",
    }
  }

  if (
    state === "needs_proofreading" ||
    state === "needs_translation" ||
    kinds.has("source")
  ) {
    return {
      kind: "content",
      kicker: "NEXT / SUBTITLES",
      title: "完成字幕內容",
      description:
        "原始字幕已經存在。複製提示後，只要用一般語言說明要保留原語，或想翻譯成哪種語言。",
      prompt: "subtitle",
    }
  }

  return {
    kind: "start",
    kicker: "NEXT / SUBTITLES",
    title: "開始製作字幕",
    description:
      "複製提示後，只要用一般語言說明想保留原語，或想翻譯成哪種語言。",
    prompt: "subtitle",
  }
}
