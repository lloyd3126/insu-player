import { lazy, Suspense, useEffect, useRef } from "react"

import { useOverlayState } from "@/app/overlay-context"
import {
  loadChromeExtensionDialog,
  loadJobDetailDialog,
  loadLibraryDialog,
  loadMyPromptsDialog,
  loadPlayerDialog,
  loadSupportedSitesDialog,
  loadUsageGuideDialog,
  loadUsagePolicyDialog,
  loadTranscriptionSettingsDialog,
} from "@/app/overlay-loaders"

const UsageGuideDialog = lazy(() =>
  loadUsageGuideDialog().then((module) => ({
    default: module.UsageGuideDialog,
  })),
)
const ChromeExtensionDialog = lazy(() =>
  loadChromeExtensionDialog().then((module) => ({
    default: module.ChromeExtensionDialog,
  })),
)
const MyPromptsDialog = lazy(() =>
  loadMyPromptsDialog().then((module) => ({
    default: module.MyPromptsDialog,
  })),
)
const SupportedSitesDialog = lazy(() =>
  loadSupportedSitesDialog().then((module) => ({
    default: module.SupportedSitesDialog,
  })),
)
const JobDetailDialog = lazy(() =>
  loadJobDetailDialog().then((module) => ({
    default: module.JobDetailDialog,
  })),
)
const LibraryDialog = lazy(() =>
  loadLibraryDialog().then((module) => ({
    default: module.LibraryDialog,
  })),
)
const PlayerDialog = lazy(() =>
  loadPlayerDialog().then((module) => ({
    default: module.PlayerDialog,
  })),
)
const UsagePolicyDialog = lazy(() =>
  loadUsagePolicyDialog().then((module) => ({
    default: module.UsagePolicyDialog,
  })),
)
const TranscriptionSettingsDialog = lazy(() =>
  loadTranscriptionSettingsDialog().then((module) => ({
    default: module.TranscriptionSettingsDialog,
  })),
)

const DIALOG_LABELS = {
  "usage-guide": "開始說明",
  "my-prompts": "我的提示",
  "supported-sites": "支援網站",
  "chrome-extension": "Chrome 擴充功能",
  "transcription-settings": "轉錄設定",
  library: "影片中心",
  player: "影音播放器",
  detail: "影音詳情",
  policy: "使用規範",
} as const

function OverlayLoadingFallback() {
  const state = useOverlayState()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    dialog.focus({ preventScroll: true })
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  if (!state) return null
  const label = DIALOG_LABELS[state.type]

  return (
    <dialog
      ref={dialogRef}
      className="overlay-loading-dialog"
      aria-label={`正在開啟${label}`}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return
        event.preventDefault()
        dialogRef.current?.focus({ preventScroll: true })
      }}
      tabIndex={0}
    >
      <span className="overlay-loading-indicator" aria-hidden="true" />
      <strong>正在開啟{label}</strong>
    </dialog>
  )
}

export function OverlayCoordinator() {
  const state = useOverlayState()
  const activeDialog = (() => {
    switch (state?.type) {
      case "usage-guide":
        return <UsageGuideDialog />
      case "my-prompts":
        return <MyPromptsDialog />
      case "supported-sites":
        return <SupportedSitesDialog />
      case "chrome-extension":
        return <ChromeExtensionDialog />
      case "transcription-settings":
        return <TranscriptionSettingsDialog />
      case "library":
        return <LibraryDialog />
      case "player":
        return <PlayerDialog />
      case "detail":
        return <JobDetailDialog />
      case "policy":
        return <UsagePolicyDialog />
      default:
        return null
    }
  })()

  return (
    <Suspense fallback={<OverlayLoadingFallback />}>
      {activeDialog}
    </Suspense>
  )
}
