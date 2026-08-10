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
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
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

function subtitleAgentPrompt(videoId: string) {
  return `請管理 INSU Player 中影音 ${videoId} 的字幕。先唯讀檢查目前的字幕產物與狀態，並詢問我要「校正原語字幕」或「翻譯字幕」。若選擇翻譯，再詢問目標 BCP 47 語言碼。來源語言細粒度時間軸只能從原始音訊以本機模型或 OpenAI API 模型建立。內容校正或翻譯，以及後續字幕切分，則各自詢問要由本機模型、OpenAI API 模型或目前的 Agent 處理。人工建立的 CC 字幕可以作為文字參考並立即播放，平台自動字幕一律不要下載、匯入或作為參考。校正路徑使用 $proofread-subtitles，翻譯路徑使用 $translate-subtitles，兩條路徑完成完整句內容後都必須再使用獨立的 $segment-subtitles，採 target-first 切分並對齊連續的 source timing，驗證通過後匯入 INSU Player。開始任何會上傳資料到 API 的操作前先取得我的明確同意。不要替我刪除字幕，也不要替我切換目前播放的字幕版本，這兩項由我在字幕管理介面操作。`
}

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
      <PromptActionCard
        kicker="AGENT WORKFLOW"
        title="製作與更新字幕"
        description="複製提示，讓 Agent 檢查現有產物、確認處理路徑並使用對應的字幕 skills。"
        prompt={subtitleAgentPrompt(meta.job.videoId)}
      />
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
