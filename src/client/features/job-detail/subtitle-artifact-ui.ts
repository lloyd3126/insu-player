import type {
  SubtitleArtifact,
  SubtitleArtifactKind,
} from "@shared/contracts/subtitle-catalog"

export const SUBTITLE_VIEWS: SubtitleArtifactKind[] = [
  "source",
  "proofread",
  "translation",
  "segmentation",
]

export const SUBTITLE_KIND_COPY: Record<
  SubtitleArtifactKind,
  { kicker: string; label: string; empty: string }
> = {
  source: {
    kicker: "SOURCE EVIDENCE",
    label: "原始字幕",
    empty: "人工 CC 或模型從音訊產生的原始字幕會顯示在這裡。",
  },
  proofread: {
    kicker: "SAME-LANGUAGE REVISION",
    label: "校正字幕",
    empty: "不翻譯時，完成同語言校正的字幕會顯示在這裡。",
  },
  translation: {
    kicker: "COMPLETE TRANSLATION",
    label: "翻譯字幕",
    empty: "完整句翻譯完成後會顯示在這裡，不需要等待字幕切分。",
  },
  segmentation: {
    kicker: "TARGET-FIRST ALIGNMENT",
    label: "切分字幕",
    empty: "完成 target-first 切分與 Source Alignment 後會顯示在這裡。",
  },
}

export function artifactLanguageCodes(artifact: SubtitleArtifact) {
  return [...new Set(artifact.tracks.map((track) => track.languageCode))]
}

export function artifactProvider(artifact: SubtitleArtifact) {
  const provider =
    artifact.processor.provider === "local"
      ? "本機"
      : artifact.processor.provider === "openai"
        ? "OpenAI API"
        : artifact.processor.provider === "agent"
          ? "Agent"
          : "yt-dlp"
  const identity = artifact.processor.model ?? artifact.processor.service
  return identity ? `${provider} · ${identity}` : provider
}

export function lifecycleLabel(artifact: SubtitleArtifact) {
  if (artifact.lifecycleState === "processing") return "處理中"
  if (artifact.lifecycleState === "failed") return "處理失敗"
  if (artifact.lifecycleState === "archived") return "已封存"
  if (artifact.lifecycleState === "draft") return "草稿"
  return "可使用"
}

export function validationLabel(artifact: SubtitleArtifact) {
  if (artifact.validationState === "warning") return "有驗證提醒"
  if (artifact.validationState === "invalid") return "驗證未通過"
  if (artifact.validationState === "pending") return "等待驗證"
  return "已驗證"
}
