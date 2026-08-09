import { useQueryClient } from "@tanstack/react-query"
import { Trash2Icon } from "lucide-react"
import type { ReactElement } from "react"

import { useOverlay } from "@/app/overlay-context"
import { ResourceRemovalDialog } from "@/components/shared/removal/ResourceRemovalDialog"
import { Button } from "@/components/ui/button"
import type { JobsResponse } from "@shared/contracts/job"

function VideoRemovalFlow({
  videoId,
  children,
}: {
  videoId: string
  children: ReactElement
}) {
  const overlay = useOverlay()
  const queryClient = useQueryClient()
  const onRemoved = () => {
    queryClient.removeQueries({ queryKey: ["job", videoId] })
    queryClient.setQueryData<JobsResponse>(["jobs"], (current) =>
      current
        ? {
            ...current,
            jobs: current.jobs.filter((candidate) => candidate.videoId !== videoId),
          }
        : current,
    )
    void queryClient.invalidateQueries({ queryKey: ["jobs"] })
    overlay.actions.open(
      { type: "library", view: null },
      { replace: true, returnTo: null },
    )
  }

  return (
    <ResourceRemovalDialog
      target={{ kind: "video", videoId }}
      title="完整移除此影音"
      description="這會永久移除影音及其所有衍生內容，且無法復原。"
      confirmLabel="移除影音"
      onRemoved={onRemoved}
    >
      {children}
    </ResourceRemovalDialog>
  )
}

export function VideoRemovalDialog({ videoId }: { videoId: string }) {
  return (
    <VideoRemovalFlow videoId={videoId}>
      <Button variant="destructive">
        <Trash2Icon data-icon="inline-start" />
        移除影音
      </Button>
    </VideoRemovalFlow>
  )
}

export function VideoCardRemovalDialog({
  videoId,
  title,
}: {
  videoId: string
  title: string
}) {
  return (
    <VideoRemovalFlow videoId={videoId}>
      <Button
        variant="destructive"
        size="icon"
        className="video-grid-card__remove"
        aria-label={`移除影音 ${title}`}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </VideoRemovalFlow>
  )
}

export function VideoListRemovalDialog({
  videoId,
  title,
}: {
  videoId: string
  title: string
}) {
  return (
    <VideoRemovalFlow videoId={videoId}>
      <Button
        variant="destructive"
        size="icon"
        aria-label={`移除影音 ${title}`}
      >
        <Trash2Icon data-icon="inline-start" />
      </Button>
    </VideoRemovalFlow>
  )
}
