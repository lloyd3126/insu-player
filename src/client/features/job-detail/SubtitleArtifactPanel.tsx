import { useQueryClient } from "@tanstack/react-query"
import { createContext, use, useCallback, useMemo, useRef } from "react"

import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import { SubtitleRevisionPreviewDialog } from "@/features/job-detail/SubtitleRevisionPreviewDialog"
import { SubtitleRevisionTable } from "@/features/job-detail/SubtitleRevisionTable"
import { JobNextActionCard } from "@/features/job-detail/JobNextActionCard"
import { useSubtitleCatalog } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import type { SubtitleCatalogResponse } from "@shared/contracts/subtitle-catalog"
import { nextActionForJob } from "@shared/domain/job-next-action"

interface SubtitleManagementContextValue {
  state: {
    catalog: SubtitleCatalogResponse
    previewArtifactId?: string
  }
  actions: {
    openPreview: (artifactId: string, trigger: HTMLButtonElement) => void
    closePreview: () => void
    artifactRemoved: (artifactId: string) => void
  }
  meta: { job: JobDetail }
}

const SubtitleManagementContext =
  createContext<SubtitleManagementContextValue | null>(null)

function useSubtitleManagement() {
  const context = use(SubtitleManagementContext)
  if (!context) {
    throw new Error(
      "useSubtitleManagement must be used within SubtitleManagementProvider",
    )
  }
  return context
}

function SubtitleManagementProvider({
  job,
  previewArtifactId,
  onPreviewArtifactChange,
  children,
}: {
  job: JobDetail
  previewArtifactId?: string
  onPreviewArtifactChange: (artifactId?: string) => void
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const catalog = useSubtitleCatalog(job.videoId)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)
  const openPreview = useCallback(
    (artifactId: string, trigger: HTMLButtonElement) => {
      previewTriggerRef.current = trigger
      onPreviewArtifactChange(artifactId)
    },
    [onPreviewArtifactChange],
  )
  const closePreview = useCallback(() => {
    onPreviewArtifactChange(undefined)
    queueMicrotask(() => previewTriggerRef.current?.focus())
  }, [onPreviewArtifactChange])
  const artifactRemoved = useCallback(
    (artifactId: string) => {
      onPreviewArtifactChange(undefined)
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
      void queryClient.invalidateQueries({ queryKey: ["job", job.videoId] })
      void queryClient.invalidateQueries({
        queryKey: ["job-subtitles", job.videoId],
      })
      queryClient.removeQueries({
        queryKey: ["job-subtitle-artifact", job.videoId, artifactId],
      })
    },
    [job.videoId, onPreviewArtifactChange, queryClient],
  )
  const contextValue = useMemo<SubtitleManagementContextValue | null>(
    () =>
      catalog.data
        ? {
            state: { catalog: catalog.data, previewArtifactId },
            actions: {
              openPreview,
              closePreview,
              artifactRemoved,
            },
            meta: { job },
          }
        : null,
    [
      artifactRemoved,
      catalog.data,
      closePreview,
      job,
      openPreview,
      previewArtifactId,
    ],
  )

  if (catalog.isPending) return <LoadingState label="正在準備字幕版本" />
  if (catalog.isError) return <ErrorState message={catalog.error.message} />
  if (!contextValue) return null

  return (
    <SubtitleManagementContext value={contextValue}>
      {children}
    </SubtitleManagementContext>
  )
}

function SubtitleManagementContent() {
  const { state, actions, meta } = useSubtitleManagement()
  const artifacts = useMemo(
    () =>
      [...state.catalog.artifacts].sort(
        (left, right) =>
          right.revision - left.revision ||
          ["source", "proofread", "translation", "segmentation"].indexOf(
            left.kind,
          ) -
            ["source", "proofread", "translation", "segmentation"].indexOf(
              right.kind,
            ),
      ),
    [state.catalog.artifacts],
  )
  const previewArtifact =
    artifacts.find((artifact) => artifact.id === state.previewArtifactId) ?? null
  const showStart =
    artifacts.length === 0 && nextActionForJob(meta.job).kind === "start"

  return (
    <div className="subtitle-management-layout">
      {showStart ? <JobNextActionCard job={meta.job} /> : null}
      {artifacts.length > 0 ? (
        <SubtitleRevisionTable
          videoId={meta.job.videoId}
          artifacts={artifacts}
          activeTracks={state.catalog.activeTracks}
          onPreview={actions.openPreview}
          onRemoved={actions.artifactRemoved}
        />
      ) : showStart ? null : (
        <EmptyState
          title="尚無字幕"
          description="字幕準備完成後會顯示在這裡。"
        />
      )}
      <SubtitleRevisionPreviewDialog
        videoId={meta.job.videoId}
        artifact={previewArtifact}
        onClose={actions.closePreview}
      />
    </div>
  )
}

export function SubtitleManagementPanel({
  job,
  previewArtifactId,
  onPreviewArtifactChange,
}: {
  job: JobDetail
  previewArtifactId?: string
  onPreviewArtifactChange: (artifactId?: string) => void
}) {
  return (
    <SubtitleManagementProvider
      job={job}
      previewArtifactId={previewArtifactId}
      onPreviewArtifactChange={onPreviewArtifactChange}
    >
      <SubtitleManagementContent />
    </SubtitleManagementProvider>
  )
}
