import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { MyPromptsContent } from "@/features/home/MyPromptsContent"

export function MyPromptsDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "my-prompts"

  return (
    <AppDialog
      open={active}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("my-prompts")
      }
      kicker="PROMPT LIBRARY"
      title="我的提示"
      description="建立、複製並重用 INSU Player 提示"
      size="screen"
      layout="tabbed"
    >
      <MyPromptsContent />
    </AppDialog>
  )
}
