import { useQueryClient } from "@tanstack/react-query"
import { Trash2Icon } from "lucide-react"
import { createContext, use, useCallback, useMemo } from "react"

import type { SubtitleManagementView } from "@/app/overlay-context"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { ResourceRemovalDialog } from "@/components/shared/removal/ResourceRemovalDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CaptionComparisonTable } from "@/features/job-detail/CaptionComparisonTable"
import {
  useActivateSubtitle,
  useSubtitleArtifactCaptions,
  useSubtitleCatalog,
} from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import type {
  SubtitleArtifact,
  SubtitleArtifactKind,
  SubtitleCatalogResponse,
} from "@shared/contracts/subtitle-catalog"

const SUBTITLE_VIEWS: SubtitleArtifactKind[] = [
  "source",
  "proofread",
  "translation",
  "segmentation",
]

const KIND_COPY: Record<
  SubtitleArtifactKind,
  { kicker: string; label: string; empty: string }
> = {
  source: {
    kicker: "SOURCE EVIDENCE",
    label: "原始字幕",
    empty: "人工 CC 或模型從音訊產生的原始字幕會顯示在這裡。",
  },
  proofread: {
    kicker: "SAME-LANGUAGE REVISION",
    label: "校正字幕",
    empty: "不翻譯時，完成同語言校正的字幕會顯示在這裡。",
  },
  translation: {
    kicker: "COMPLETE TRANSLATION",
    label: "翻譯字幕",
    empty: "完整句翻譯完成後會顯示在這裡，不需要等待字幕切分。",
  },
  segmentation: {
    kicker: "TARGET-FIRST ALIGNMENT",
    label: "切分字幕",
    empty: "完成 target-first 切分與 Source Alignment 後會顯示在這裡。",
  },
}

function subtitleAgentPrompt(videoId: string) {
  return `請管理 INSU Player 中影音 ${videoId} 的字幕。先唯讀檢查目前的字幕產物與狀態，並詢問我要「校正原語字幕」或「翻譯字幕」，若選擇翻譯，再詢問目標 BCP 47 語言碼，以及轉錄與內容處理要使用本機模型或 OpenAI API 模型。人工建立的 CC 字幕可以作為文字參考並立即播放，平台自動字幕一律不要下載、匯入或作為參考。只要要製作校正、翻譯或切分字幕，都必須從原始音訊以模型建立來源語言的 word、token 或 grapheme-group 細粒度時間軸。校正路徑使用 $proofread-subtitles，翻譯路徑使用 $translate-subtitles，兩條路徑完成完整句內容後都必須再使用獨立的 $segment-subtitles，採 target-first 切分並對齊連續的 source timing，驗證通過後匯入 INSU Player。開始任何會上傳資料到 API 的操作前先取得我的明確同意。不要替我刪除字幕，也不要替我切換目前播放的字幕版本，這兩項由我在字幕管理介面操作。`
}

function revisionLabel(artifact: SubtitleArtifact) {
  const languagePair = artifact.outputLanguage
    ? artifact.outputLanguage === artifact.sourceLanguage
      ? `${artifact.sourceLanguage} · 同語校正`
      : `${artifact.sourceLanguage} → ${artifact.outputLanguage}`
    : artifact.sourceLanguage
  return `r${artifact.revision} · ${languagePair}`
}

function lifecycleLabel(artifact: SubtitleArtifact) {
  if (artifact.lifecycleState === "processing") return "處理中"
  if (artifact.lifecycleState === "failed") return "處理失敗"
  if (artifact.lifecycleState === "archived") return "已封存"
  if (artifact.lifecycleState === "draft") return "草稿"
  return "可使用"
}

function validationLabel(artifact: SubtitleArtifact) {
  if (artifact.validationState === "warning") return "有驗證提醒"
  if (artifact.validationState === "invalid") return "驗證未通過"
  if (artifact.validationState === "pending") return "等待驗證"
  return "已驗證"
}

function artifactProvider(artifact: SubtitleArtifact) {
  if (artifact.provider && artifact.model) {
    return `${artifact.provider} · ${artifact.model}`
  }
  return artifact.provider ?? artifact.model ?? "尚未記錄"
}

interface SubtitleManagementState {
  catalog: SubtitleCatalogResponse
  view: SubtitleManagementView
  selectedArtifactId?: string
}

interface SubtitleManagementContextValue {
  state: SubtitleManagementState
  actions: {
    selectView: (view: SubtitleManagementView) => void
    selectArtifact: (artifactId?: string) => void
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
  selectedArtifactId,
  onViewChange,
  onArtifactChange,
  children,
}: {
  job: JobDetail
  view: SubtitleManagementView
  selectedArtifactId?: string
  onViewChange: (view: SubtitleManagementView) => void
  onArtifactChange: (artifactId?: string) => void
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const catalog = useSubtitleCatalog(job.videoId)
  const artifactRemoved = useCallback(
    (artifactId: string) => {
      onArtifactChange(undefined)
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
      void queryClient.invalidateQueries({ queryKey: ["job", job.videoId] })
      void queryClient.invalidateQueries({
        queryKey: ["job-subtitles", job.videoId],
      })
      queryClient.removeQueries({
        queryKey: ["job-subtitle-artifact", job.videoId, artifactId],
      })
    },
    [job.videoId, onArtifactChange, queryClient],
  )

  if (catalog.isPending) return <LoadingState label="正在準備字幕版本" />
  if (catalog.isError) return <ErrorState message={catalog.error.message} />
  if (!catalog.data) return null

  return (
    <SubtitleManagementContext
      value={{
        state: { catalog: catalog.data, view, selectedArtifactId },
        actions: {
          selectView: onViewChange,
          selectArtifact: onArtifactChange,
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
          <label key={language.languageCode}>
            <span>{language.languageCode}</span>
            <Select
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
          </label>
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

function SubtitleArtifactToolbar({
  artifact,
  artifacts,
}: {
  artifact: SubtitleArtifact
  artifacts: SubtitleArtifact[]
}) {
  const { actions, meta } = useSubtitleManagement()
  const items = artifacts.map((candidate) => ({
    value: candidate.id,
    label: revisionLabel(candidate),
  }))
  return (
    <div className="subtitle-artifact-toolbar">
      <div className="subtitle-artifact-toolbar__revision">
        <span className="section-index">REVISION</span>
        <Select
          items={items}
          value={artifact.id}
          onValueChange={(value) => value && actions.selectArtifact(value)}
        >
          <SelectTrigger aria-label="字幕版本">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="subtitle-artifact-toolbar__facts">
        <LanguageCodeList
          codes={[...new Set(artifact.tracks.map((track) => track.languageCode))]}
        />
        <Badge variant="secondary">{lifecycleLabel(artifact)}</Badge>
        <Badge variant="outline">{validationLabel(artifact)}</Badge>
        {artifact.freshnessState !== "current" ? (
          <Badge variant="outline">
            {artifact.freshnessState === "stale" ? "等待新版" : "已有新版"}
          </Badge>
        ) : null}
        <span>{artifactProvider(artifact)}</span>
        {artifact.warningCount > 0 ? (
          <span>{artifact.warningCount} 個提醒</span>
        ) : null}
        {artifact.hardDefectCount > 0 ? (
          <Badge variant="destructive">
            {artifact.hardDefectCount} 個必要修正
          </Badge>
        ) : null}
      </div>
      <ResourceRemovalDialog
        target={{
          kind: "subtitle-artifact",
          videoId: meta.job.videoId,
          artifactId: artifact.id,
        }}
        title={`移除${KIND_COPY[artifact.kind].label}`}
        description="這會永久移除選定版本及依賴它的下游字幕，且無法復原。"
        confirmLabel="移除字幕"
        onRemoved={() => actions.artifactRemoved(artifact.id)}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={`移除${KIND_COPY[artifact.kind].label}`}
        >
          <Trash2Icon />
        </Button>
      </ResourceRemovalDialog>
    </div>
  )
}

function SubtitleArtifactWorkspace({ kind }: { kind: SubtitleArtifactKind }) {
  const { state, meta } = useSubtitleManagement()
  const artifacts = useMemo(
    () =>
      state.catalog.artifacts
        .filter((artifact) => artifact.kind === kind)
        .sort((left, right) => right.revision - left.revision),
    [kind, state.catalog.artifacts],
  )
  const artifact =
    artifacts.find((candidate) => candidate.id === state.selectedArtifactId) ??
    artifacts[0]
  const comparison = useSubtitleArtifactCaptions(
    meta.job.videoId,
    artifact?.id ?? null,
  )
  const copy = KIND_COPY[kind]

  return (
    <div className="subtitle-artifact-workspace">
      {artifact ? (
        <>
          <SubtitleArtifactToolbar artifact={artifact} artifacts={artifacts} />
          {comparison.isPending ? (
            <LoadingState label={`正在讀取${copy.label}`} />
          ) : null}
          {comparison.isError ? (
            <ErrorState message={comparison.error.message} />
          ) : null}
          {comparison.data ? (
            <CaptionComparisonTable
              comparison={comparison.data}
              kicker={copy.kicker}
              title={`${copy.label} · r${artifact.revision}`}
              emptyTitle={`尚無${copy.label}`}
              emptyDescription={copy.empty}
            />
          ) : null}
        </>
      ) : (
        <CaptionComparisonTable
          comparison={{
            videoId: meta.job.videoId,
            baselineTrackId: null,
            tracks: [],
            rows: [],
          }}
          emptyTitle={`尚無${copy.label}`}
          emptyDescription={copy.empty}
        />
      )}
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
            {KIND_COPY[kind].label}
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
  selectedArtifactId,
  onViewChange,
  onArtifactChange,
}: {
  job: JobDetail
  view: SubtitleManagementView
  selectedArtifactId?: string
  onViewChange: (view: SubtitleManagementView) => void
  onArtifactChange: (artifactId?: string) => void
}) {
  return (
    <SubtitleManagementProvider
      job={job}
      view={view}
      selectedArtifactId={selectedArtifactId}
      onViewChange={onViewChange}
      onArtifactChange={onArtifactChange}
    >
      <SubtitleManagementContent />
    </SubtitleManagementProvider>
  )
}
