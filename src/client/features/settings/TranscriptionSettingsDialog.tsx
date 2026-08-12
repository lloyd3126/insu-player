import { useCallback } from "react"

import { useOverlayActions, useOverlayState } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ModelsContent } from "@/features/resources/ModelsDialog"
import { RoutedModelDetailsDialog } from "@/features/resources/ModelDetailsDialog"

export function TranscriptionSettingsDialog() {
  const state = useOverlayState()
  const actions = useOverlayActions()
  const active =
    state?.type === "transcription-settings" ? state : null
  const returnTo = active?.returnTo
  const openDetails = useCallback((modelId: string) => {
    actions.open({
      type: "transcription-settings",
      modelId,
      returnTo,
    })
  }, [actions, returnTo])
  const closeDetails = useCallback(() => {
    actions.open(
      {
        type: "transcription-settings",
        returnTo,
      },
      { replace: true, returnTo: returnTo ?? null },
    )
  }, [actions, returnTo])
  const handleDetailsOpenChange = useCallback((open: boolean) => {
    if (!open) closeDetails()
  }, [closeDetails])

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : actions.close("transcription-settings")
      }
      kicker="TRANSCRIPTION"
      title="轉錄設定"
      description="選擇並管理語音辨識模型"
      size="wide"
      height="screen"
      layout="scroll"
    >
      <ModelsContent onOpenDetails={openDetails} />
      <RoutedModelDetailsDialog
        modelId={active?.modelId}
        onOpenChange={handleDetailsOpenChange}
      />
    </AppDialog>
  )
}
