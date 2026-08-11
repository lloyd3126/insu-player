import { useMutation } from "@tanstack/react-query"
import { Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { type ReactElement, useState } from "react"

import { api } from "@/api/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"
import type { RemovalIssue, RemovalTarget } from "@shared/contracts/removal"

interface ResourceRemovalDialogProps {
  children: ReactElement
  target: RemovalTarget
  title: string
  description: string
  confirmLabel: string
  onRemoved: () => void
}

function blockerMessage(blocker: RemovalIssue) {
  if (blocker.code === "active-process") {
    return "這項內容仍在處理中，請等待處理結束後再試。"
  }
  if (blocker.code === "dependent-summary-artifact") {
    return "請先移除依賴這項內容的心智圖或文字摘要，再重新開啟刪除視窗。"
  }
  if (blocker.code === "active-rendition") {
    return "請先切換到另一個已下載的播放畫質，再重新開啟刪除視窗。"
  }
  return "目前無法安全移除這項內容，請稍後再試。"
}

export function ResourceRemovalDialog({
  children,
  target,
  title,
  description,
  confirmLabel,
  onRemoved,
}: ResourceRemovalDialogProps) {
  const [open, setOpen] = useState(false)
  const preview = useMutation({
    mutationFn: () => api.previewRemoval(target),
  })
  const execute = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("removal preview is unavailable")
      return api.executeRemoval(target, preview.data.planDigest)
    },
    onSuccess: () => {
      setOpen(false)
      onRemoved()
    },
  })
  const blocker = preview.data?.blocked[0]
  const busy = preview.isPending || execute.isPending
  const ready = Boolean(preview.data && !blocker)
  const problem = preview.isError
    ? "無法完成移除前檢查，請關閉後再試。"
    : execute.isError
      ? "移除失敗或內容已經變更，請關閉後再試。"
      : blocker
        ? blockerMessage(blocker)
        : null

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && execute.isPending) return
    setOpen(nextOpen)
    if (!nextOpen) return
    preview.reset()
    execute.reset()
    preview.mutate()
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger render={children} />
      <AlertDialogContent overlayEmphasis="strong">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {problem ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>目前無法移除</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={execute.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={!ready || busy}
            onClick={() => execute.mutate()}
          >
            {preview.isPending ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : null}
            {execute.isPending ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : null}
            {preview.isPending
              ? "正在檢查"
              : execute.isPending
                ? "正在移除"
                : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
