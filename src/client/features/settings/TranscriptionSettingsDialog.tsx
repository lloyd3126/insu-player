import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ModelsContent } from "@/features/resources/ModelsDialog"
import { RoutedModelDetailsDialog } from "@/features/resources/ModelDetailsDialog"

export function TranscriptionSettingsDialog() {
  const overlay = useOverlay()
  const active =
    overlay.state?.type === "transcription-settings" ? overlay.state : null
  const openDetails = (modelId: string) => {
    overlay.actions.open({
      type: "transcription-settings",
      modelId,
      returnTo: active?.returnTo,
    })
  }
  const closeDetails = () => {
    overlay.actions.open(
      {
        type: "transcription-settings",
        returnTo: active?.returnTo,
      },
      { replace: true, returnTo: active?.returnTo ?? null },
    )
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("transcription-settings")
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
        onOpenChange={(open) => {
          if (!open) closeDetails()
        }}
      />
    </AppDialog>
  )
}
