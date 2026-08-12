import type { TranscriptionModel } from "@shared/contracts/resources"

export function modelStatusLabel(model: TranscriptionModel) {
  const labels: Record<TranscriptionModel["status"], string> = {
    ready: "可使用",
    "not-downloaded": "未下載",
    downloading: "下載中",
    validating: "正在驗證",
    "redownload-required": "需要重新下載",
    "download-failed": "下載失敗",
    "sdk-missing": "SDK 未安裝",
    "credential-missing": "尚未設定 API Key",
  }
  return labels[model.status]
}
