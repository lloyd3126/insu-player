import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "@/api/client"
import { useOverlay, type LibraryView } from "@/app/overlay-context"
import {
  loadJobDetailDialog,
  loadPlayerDialog,
} from "@/app/overlay-loaders"
import { AppDialog } from "@/components/shared/AppDialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import { CaptionLanguageSelect } from "@/components/shared/CaptionLanguageSelect"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  VideoCardRemovalDialog,
  VideoListRemovalDialog,
} from "@/features/job-detail/VideoRemovalDialog"
import { MediaCard } from "@/features/library/MediaCard"
import {
  DownloadItemProgress,
  DownloadMediaCard,
} from "@/features/library/DownloadMediaCard"
import { useLibraryQuery } from "@/hooks/use-library-query"
import { getJobPreferredCaption, NO_CAPTION } from "@/lib/captions"
import { cn } from "@/lib/utils"
import type {
  DownloadLibraryItem,
  DownloadQueueSummary,
  LibraryItem,
  LibraryResponse,
  MediaLibraryItem,
} from "@shared/contracts/library"
import { formatBytes } from "@shared/domain/format"
import { ACTIVE_STATES, ATTENTION_STATES } from "@shared/domain/job-status"

type Filter = "all" | "active" | "attention" | "watchable" | "ready"
const FILTERS = [
  { value: "all", label: "全部狀態" },
  { value: "active", label: "處理中" },
  { value: "attention", label: "需要處理" },
  { value: "watchable", label: "可觀看" },
  { value: "ready", label: "已完成" },
]
const ACTIVE_DOWNLOAD_STATES = new Set([
  "checking",
  "queued",
  "downloading",
  "verifying",
])
const ATTENTION_DOWNLOAD_STATES = new Set([
  "needs_confirmation",
  "failed",
  "cancelled",
])

function itemTitle(item: LibraryItem) {
  return item.kind === "media" ? item.job.title : item.title
}

function itemVideoId(item: LibraryItem) {
  return item.kind === "media" ? item.job.videoId : item.videoId
}

function matchesFilter(item: LibraryItem, filter: Filter) {
  if (item.kind === "download") {
    if (filter === "active") return ACTIVE_DOWNLOAD_STATES.has(item.state)
    if (filter === "attention") return ATTENTION_DOWNLOAD_STATES.has(item.state)
    return filter === "all"
  }
  const state = item.job.effectiveState || item.job.state
  if (filter === "active") return ACTIVE_STATES.has(state)
  if (filter === "attention") return ATTENTION_STATES.has(state)
  if (filter === "watchable") return item.job.watchable
  if (filter === "ready") return state === "ready"
  return true
}

function LibrarySearch({
  value,
  onChange,
  className = "",
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={cn("search-control", className)}>
      <span className="sr-only">搜尋影音</span>
      <SearchIcon aria-hidden="true" />
      <Input
        type="search"
        placeholder="搜尋標題、影音 ID 或網址"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function DownloadQueueControl({ queue }: { queue: DownloadQueueSummary }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: queue.paused ? api.resumeDownloadQueue : api.pauseDownloadQueue,
    onSuccess: (response) => {
      queryClient.setQueryData<LibraryResponse>(["library"], response)
    },
  })
  if (queue.activeCount === 0 && queue.queuedCount === 0 && !queue.paused) {
    return null
  }
  return (
    <div className="library-queue-control" aria-label="下載排程">
      <div>
        <strong>{queue.paused ? "下載排程已暫停" : "下載排程進行中"}</strong>
        <small>
          下載中 {queue.activeCount} 個 · 等待 {queue.queuedCount} 個 · 同時最多 {queue.concurrency} 個
        </small>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : queue.paused ? (
          <PlayIcon data-icon="inline-start" />
        ) : (
          <PauseIcon data-icon="inline-start" />
        )}
        {queue.paused ? "繼續下載" : "暫停排程"}
      </Button>
      {mutation.isError ? <small role="alert">{mutation.error.message}</small> : null}
    </div>
  )
}

function DownloadItemActions({ item }: { item: DownloadLibraryItem }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: "cancel" | "retry" | "approve") => {
      if (action === "cancel") return api.cancelLibraryDownload(item.id)
      if (action === "approve") return api.approveLowQualityDownload(item.id)
      return api.retryLibraryDownload(item.id)
    },
    onSuccess: (response) => {
      queryClient.setQueryData<LibraryResponse>(["library"], response)
    },
  })
  if (item.state === "needs_confirmation") {
    return (
      <div className="library-download-actions">
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("approve")}
        >
          {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
          同意低於 720p
        </Button>
        {mutation.isError ? <small role="alert">{mutation.error.message}</small> : null}
      </div>
    )
  }
  const retryable = item.state === "failed" || item.state === "cancelled"
  const cancellable = ACTIVE_DOWNLOAD_STATES.has(item.state)
  if (!retryable && !cancellable) return null
  const action = retryable ? "retry" : "cancel"
  const label = retryable ? `重新下載 ${item.title}` : `取消下載 ${item.title}`
  return (
    <div className="library-download-actions">
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button
              size="icon"
              variant="ghost"
              aria-label={label}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(action)}
            />
          )}
        >
          {mutation.isPending ? (
            <Spinner />
          ) : retryable ? (
            <RotateCcwIcon />
          ) : (
            <BanIcon />
          )}
        </TooltipTrigger>
        <TooltipContent>{retryable ? "重新下載" : "取消下載"}</TooltipContent>
      </Tooltip>
      {mutation.isError ? <small role="alert">{mutation.error.message}</small> : null}
    </div>
  )
}

function MediaRow({ item }: { item: MediaLibraryItem }) {
  const job = item.job
  const { actions } = useOverlay()
  const [selectedCaption, setSelectedCaption] = useState(() =>
    getJobPreferredCaption(job),
  )
  const caption = job.captionCodes.includes(selectedCaption)
    ? selectedCaption
    : getJobPreferredCaption(job)
  const openPlayer = async () => {
    await loadPlayerDialog()
    actions.open({
      type: "player",
      videoId: job.videoId,
      caption: caption === NO_CAPTION ? undefined : caption,
    })
  }
  const openDetails = async () => {
    await loadJobDetailDialog()
    actions.open({ type: "detail", videoId: job.videoId, tab: "about" })
  }
  return (
    <TableRow>
      <TableCell data-label="影音">
        <div className="job-title-cell">
          <div className="job-thumbnail">
            {job.thumbnailUrl ? (
              <img src={job.thumbnailUrl} alt="" loading="lazy" />
            ) : (
              <span>INSU</span>
            )}
          </div>
          <div>
            <Button
              className="job-title-link"
              variant="link"
              onPointerEnter={() => void loadJobDetailDialog()}
              onFocus={() => void loadJobDetailDialog()}
              onPointerDown={() => void loadJobDetailDialog()}
              onClick={openDetails}
            >
              <strong title={job.title}>{job.title}</strong>
            </Button>
            <small>{job.videoId}</small>
          </div>
        </div>
      </TableCell>
      <TableCell data-label="字幕">
        <CaptionLanguageSelect
          codes={job.captionCodes}
          value={caption}
          onValueChange={setSelectedCaption}
          label={`${job.title} 字幕`}
          className="caption-language-select"
        />
      </TableCell>
      <TableCell data-label="操作">
        <div className="job-actions">
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  size="icon"
                  disabled={!job.watchable}
                  aria-label={`觀看 ${job.title}`}
                  onPointerEnter={() => void loadPlayerDialog()}
                  onFocus={() => void loadPlayerDialog()}
                  onPointerDown={() => void loadPlayerDialog()}
                  onClick={openPlayer}
                />
              )}
            >
              <PlayIcon />
            </TooltipTrigger>
            <TooltipContent>觀看</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`設定 ${job.title}`}
                  onPointerEnter={() => void loadJobDetailDialog()}
                  onFocus={() => void loadJobDetailDialog()}
                  onPointerDown={() => void loadJobDetailDialog()}
                  onClick={openDetails}
                />
              )}
            >
              <SettingsIcon />
            </TooltipTrigger>
            <TooltipContent>設定</TooltipContent>
          </Tooltip>
          <VideoListRemovalDialog videoId={job.videoId} title={job.title} />
        </div>
      </TableCell>
    </TableRow>
  )
}

function DownloadRow({ item }: { item: DownloadLibraryItem }) {
  return (
    <TableRow>
      <TableCell data-label="影音">
        <div className="job-title-cell">
          <div className="job-thumbnail job-thumbnail--download">
            <DownloadIcon aria-hidden="true" />
          </div>
          <div className="library-download-title">
            <strong title={item.title}>{item.title}</strong>
            <small title={item.pageUrl}>{item.pageUrl}</small>
            <DownloadItemProgress item={item} />
          </div>
        </div>
      </TableCell>
      <TableCell data-label="字幕">—</TableCell>
      <TableCell data-label="操作">
        <DownloadItemActions item={item} />
      </TableCell>
    </TableRow>
  )
}

function MediaGridCard({ item }: { item: MediaLibraryItem }) {
  const job = item.job
  const { actions } = useOverlay()
  const caption = getJobPreferredCaption(job)
  const loadJobDialog = job.watchable ? loadPlayerDialog : loadJobDetailDialog
  const openJob = async () => {
    await loadJobDialog()
    if (!job.watchable) {
      actions.open({ type: "detail", videoId: job.videoId, tab: "about" })
      return
    }
    actions.open({
      type: "player",
      videoId: job.videoId,
      caption: caption === NO_CAPTION ? undefined : caption,
    })
  }
  return (
    <MediaCard
      job={job}
      actionLabel={job.watchable ? "觀看" : "查看"}
      onOpen={openJob}
    >
      <VideoCardRemovalDialog videoId={job.videoId} title={job.title} />
    </MediaCard>
  )
}

function DownloadGridCard({ item }: { item: DownloadLibraryItem }) {
  return (
    <DownloadMediaCard item={item}>
      <DownloadItemActions item={item} />
    </DownloadMediaCard>
  )
}

function Metrics({ items }: { items: LibraryItem[] }) {
  const media = items.filter((item): item is MediaLibraryItem => item.kind === "media")
  const totalSize = media.reduce((sum, item) => sum + item.job.sizeBytes, 0)
  const metrics = [
    ["全部項目", items.length, "ARCHIVE"],
    ["處理中", items.filter((item) => matchesFilter(item, "active")).length, "IN FLIGHT"],
    ["需要處理", items.filter((item) => matchesFilter(item, "attention")).length, "ATTENTION"],
    ["可觀看", media.filter((item) => item.job.watchable).length, "SCREENABLE"],
    ["媒體容量", formatBytes(totalSize), "LOCAL STORAGE"],
  ] as const
  return (
    <section className="metrics" aria-label="影片中心摘要">
      {metrics.map(([label, value, caption]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{caption}</small>
        </article>
      ))}
    </section>
  )
}

export function LibraryDialog() {
  const overlay = useOverlay()
  const query = useLibraryQuery()
  const items = query.data?.items ?? []
  const active = overlay.state?.type === "library" ? overlay.state : null
  const search = active?.query ?? ""
  const filter = (active?.status ?? "all") as Filter
  const selectedView = active?.view ?? (items.length > 0 ? "grid" : "list")
  const updateLibrary = (patch: {
    view?: LibraryView
    query?: string
    status?: Filter
  }) => {
    if (!active) return
    overlay.actions.open(
      {
        type: "library",
        view: patch.view ?? selectedView,
        query: patch.query ?? search,
        status: patch.status ?? filter,
      },
      { replace: true },
    )
  }
  const searched = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("zh-TW")
    return items.filter((item) => {
      const videoId = itemVideoId(item)
      const sourceUrl = item.kind === "media" ? item.job.sourceUrl : item.pageUrl
      return (
        !normalized ||
        itemTitle(item).toLocaleLowerCase("zh-TW").includes(normalized) ||
        Boolean(videoId?.toLocaleLowerCase("en").includes(normalized)) ||
        sourceUrl.toLocaleLowerCase("en").includes(normalized)
      )
    })
  }, [items, search])
  const filtered = useMemo(
    () => searched.filter((item) => matchesFilter(item, filter)),
    [filter, searched],
  )
  const feedback = (visibleCount: number) => (
    <>
      {query.isPending ? <LoadingState label="正在讀取影片中心" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.isSuccess && items.length === 0 ? (
        <EmptyState
          title="目前還沒有影音"
          description="點首頁的加入影音，送出後會立即在這裡看到下載進度。"
        />
      ) : null}
      {query.isSuccess && items.length > 0 && visibleCount === 0 ? (
        <EmptyState
          title="找不到符合條件的影音"
          description="調整搜尋字詞或狀態篩選。"
        />
      ) : null}
    </>
  )

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => (open ? undefined : overlay.actions.close("library"))}
      kicker="LOCAL LIBRARY · LIVE"
      title="影片中心"
      description="下載中與已完成的影音都集中在同一個位置"
      size="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs library-view-tabs"
        value={selectedView}
        onValueChange={(value) =>
          overlay.actions.open({
            type: "library",
            view: value as LibraryView,
            query: search,
            status: filter,
          })
        }
      >
        <TabsList variant="line" aria-label="影片中心分頁">
          <TabsTrigger value="grid">我的影音</TabsTrigger>
          <TabsTrigger value="list">詳細資訊</TabsTrigger>
        </TabsList>

        <TabsContent
          value="grid"
          className="grouped-dialog-panel library-view-panel library-media-panel"
        >
          {query.data ? <DownloadQueueControl queue={query.data.queue} /> : null}
          <LibrarySearch
            className="library-media-search"
            value={search}
            onChange={(value) => updateLibrary({ query: value })}
          />
          {feedback(searched.length)}
          {searched.length > 0 ? (
            <div className="video-grid">
              {searched.map((item) =>
                item.kind === "media" ? (
                  <MediaGridCard key={item.id} item={item} />
                ) : (
                  <DownloadGridCard key={item.id} item={item} />
                ),
              )}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent
          value="list"
          className="grouped-dialog-panel library-view-panel library-details-panel"
        >
          {query.data ? <Metrics items={items} /> : null}
          <section className="library-panel" aria-label="影音詳細資訊">
            <div className="library-toolbar">
              {query.data ? <DownloadQueueControl queue={query.data.queue} /> : null}
              <div className="library-toolbar__controls">
                <LibrarySearch
                  value={search}
                  onChange={(value) => updateLibrary({ query: value })}
                />
                <Select
                  items={FILTERS}
                  value={filter}
                  onValueChange={(value) =>
                    updateLibrary({ status: value as Filter })
                  }
                >
                  <SelectTrigger aria-label="篩選狀態">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FILTERS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="立即重新整理"
                  onClick={() => query.refetch()}
                >
                  <RefreshCwIcon />
                </Button>
              </div>
            </div>
            {feedback(filtered.length)}
            {filtered.length > 0 ? (
              <div className="job-table-frame">
                <Table className="job-table">
                  <colgroup>
                    <col className="video-column" />
                    <col className="caption-column" />
                    <col className="action-column" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>影音</TableHead>
                      <TableHead>字幕</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) =>
                      item.kind === "media" ? (
                        <MediaRow key={item.id} item={item} />
                      ) : (
                        <DownloadRow key={item.id} item={item} />
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
