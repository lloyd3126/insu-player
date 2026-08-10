import { useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react"

import type { SubtitleManagementView } from "@/app/overlay-context"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubtitleRevisionPreviewDialog } from "@/features/job-detail/SubtitleRevisionPreviewDialog"
import { SubtitleRevisionTable } from "@/features/job-detail/SubtitleRevisionTable"
import { SubtitleCreationCard } from "@/features/job-detail/SubtitleCreationCard"
import { JobNextActionCard } from "@/features/job-detail/JobNextActionCard"
import {
  SUBTITLE_KIND_COPY,
  SUBTITLE_VIEWS,
} from "@/features/job-detail/subtitle-artifact-ui"
import { useActivateSubtitle, useSubtitleCatalog } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import type {
  SubtitleArtifactKind,
  SubtitleCatalogResponse,
} from "@shared/contracts/subtitle-catalog"

interface SubtitleManagementState {
  catalog: SubtitleCatalogResponse
  view: SubtitleManagementView
  previewArtifactId?: string
}

interface SubtitleManagementContextValue {
  state: SubtitleManagementState
  actions: {
    selectView: (view: SubtitleManagementView) => void
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
  view,
  previewArtifactId,
  onViewChange,
  onPreviewArtifactChange,
  children,
}: {
  job: JobDetail
  view: SubtitleManagementView
  previewArtifactId?: string
  onViewChange: (view: SubtitleManagementView) => void
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

  if (catalog.isPending) return <LoadingState label="正在準備字幕版本" />
  if (catalog.isError) return <ErrorState message={catalog.error.message} />
  if (!catalog.data) return null

  return (
    <SubtitleManagementContext
      value={{
        state: { catalog: catalog.data, view, previewArtifactId },
        actions: {
          selectView: onViewChange,
          openPreview,
          closePreview,
          artifactRemoved,
        },
        meta: { job },
      }}
    >
      {children}
    </SubtitleManagementContext>
  )
}

function SubtitlePlaybackSelector() {
  const { state, meta } = useSubtitleManagement()
  const activation = useActivateSubtitle(meta.job.videoId)

  if (state.catalog.playbackLanguages.length === 0) {
    return (
      <div className="subtitle-playback-selector subtitle-playback-selector--empty">
        <span className="section-index">PLAYBACK VERSION</span>
        <p>目前沒有通過驗證且可播放的字幕版本。</p>
      </div>
    )
  }
  return (
    <section className="subtitle-playback-selector" aria-label="播放字幕版本">
      <div className="subtitle-playback-selector__heading">
        <span className="section-index">PLAYBACK VERSION</span>
        <strong>目前播放版本</strong>
      </div>
      <div className="subtitle-playback-selector__controls">
        {state.catalog.playbackLanguages.map((language) => (
          <Select
            key={language.languageCode}
            items={language.options.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            value={language.activeTrackId}
            disabled={activation.isPending}
            onValueChange={(trackId) => {
              if (trackId && trackId !== language.activeTrackId) {
                activation.mutate({
                  languageCode: language.languageCode,
                  trackId,
                })
              }
            }}
          >
            <SelectTrigger aria-label={`${language.languageCode} 播放版本`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {language.options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>
      {activation.isError ? (
        <p className="form-error" role="alert">
          {activation.error.message}
        </p>
      ) : null}
    </section>
  )
}

function SubtitleArtifactWorkspace({ kind }: { kind: SubtitleArtifactKind }) {
  const { state, actions, meta } = useSubtitleManagement()
  const artifacts = useMemo(
    () =>
      state.catalog.artifacts
        .filter((artifact) => artifact.kind === kind)
        .sort((left, right) => right.revision - left.revision),
    [kind, state.catalog.artifacts],
  )
  const previewArtifact =
    artifacts.find((candidate) => candidate.id === state.previewArtifactId) ??
    null
  const copy = SUBTITLE_KIND_COPY[kind]

  useEffect(() => {
    if (state.previewArtifactId && !previewArtifact) {
      actions.closePreview()
    }
  }, [actions, previewArtifact, state.previewArtifactId])

  return (
    <div className="subtitle-artifact-workspace">
      {kind !== "source" ? (
        <SubtitleCreationCard
          videoId={meta.job.videoId}
          kind={kind}
          catalog={state.catalog}
        />
      ) : null}
      {artifacts.length > 0 ? (
        <SubtitleRevisionTable
          videoId={meta.job.videoId}
          kind={kind}
          artifacts={artifacts}
          activeTracks={state.catalog.activeTracks}
          onPreview={actions.openPreview}
          onRemoved={actions.artifactRemoved}
        />
      ) : (
        <EmptyState title={`尚無${copy.label}`} description={copy.empty} />
      )}
      <SubtitleRevisionPreviewDialog
        videoId={meta.job.videoId}
        artifact={previewArtifact}
        onClose={actions.closePreview}
      />
    </div>
  )
}

function SubtitleManagementTabs() {
  const { state, actions } = useSubtitleManagement()
  return (
    <Tabs
      value={state.view}
      onValueChange={(value) =>
        actions.selectView(value as SubtitleManagementView)
      }
      className="subtitle-management-tabs"
    >
      <TabsList variant="line" aria-label="字幕類型">
        {SUBTITLE_VIEWS.map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {SUBTITLE_KIND_COPY[kind].label}
          </TabsTrigger>
        ))}
      </TabsList>
      {SUBTITLE_VIEWS.map((kind) => (
        <TabsContent
          key={kind}
          value={kind}
          className="subtitle-management-panel"
        >
          {state.view === kind ? <SubtitleArtifactWorkspace kind={kind} /> : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}

function SubtitleManagementContent() {
  const { meta } = useSubtitleManagement()
  return (
    <div className="subtitle-management-layout">
      <JobNextActionCard job={meta.job} />
      <SubtitlePlaybackSelector />
      <SubtitleManagementTabs />
    </div>
  )
}

export function SubtitleManagementPanel({
  job,
  view,
  previewArtifactId,
  onViewChange,
  onPreviewArtifactChange,
}: {
  job: JobDetail
  view: SubtitleManagementView
  previewArtifactId?: string
  onViewChange: (view: SubtitleManagementView) => void
  onPreviewArtifactChange: (artifactId?: string) => void
}) {
  return (
    <SubtitleManagementProvider
      job={job}
      view={view}
      previewArtifactId={previewArtifactId}
      onViewChange={onViewChange}
      onPreviewArtifactChange={onPreviewArtifactChange}
    >
      <SubtitleManagementContent />
    </SubtitleManagementProvider>
  )
}
