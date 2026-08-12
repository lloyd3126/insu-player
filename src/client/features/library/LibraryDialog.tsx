import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HardDriveIcon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  TriangleAlertIcon,
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
} from "@/features/job-detail/VideoRemovalDialog"
import { MediaCard } from "@/features/library/MediaCard"
import { ImportMediaCard } from "@/features/library/ImportMediaCard"
import { LocalMediaImportDialog } from "@/features/library/LocalMediaImportDialog"
import { SubtitleStylePanel } from "@/features/library/SubtitleStylePanel"
import {
  DownloadProgressValue,
  DownloadMediaCard,
} from "@/features/library/DownloadMediaCard"
import { useLibraryQuery } from "@/hooks/use-library-query"
import { getJobPreferredCaption, NO_CAPTION } from "@/lib/captions"
import { cn } from "@/lib/utils"
import type {
  DownloadLibraryItem,
  LibraryItem,
  LibraryResponse,
  MediaLibraryItem,
} from "@shared/contracts/library"
import { formatBytes } from "@shared/domain/format"

type Filter = "all" | "active" | "attention" | "watchable" | "ready"
const ACTIVE_DOWNLOAD_STATES = new Set([
  "checking",
  "queued",
  "downloading",
  "verifying",
])
const EMPTY_LIBRARY_ITEMS: LibraryItem[] = []

function itemTitle(item: LibraryItem) {
  return item.kind === "media" ? item.job.title : item.title
}

function itemVideoId(item: LibraryItem) {
  return item.kind === "media" ? item.job.videoId : item.videoId
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

function DownloadQueueForm() {
  const queryClient = useQueryClient()
  const [input, setInput] = useState("")
  const url = input.trim()
  const createItem = useMutation({
    mutationFn: () =>
      api.createLibraryItems(
        [{ kind: "page" as const, pageUrl: url }],
        true,
      ),
    onSuccess: () => {
      setInput("")
      void queryClient.invalidateQueries({ queryKey: ["library"] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
    },
  })

  return (
    <section className="library-download-composer" aria-labelledby="download-media-title">
      <div className="library-download-composer__heading">
        <h2 id="download-media-title">下載影音</h2>
        <p>
          點擊下載按鈕代表有權下載、轉錄與觀看這項內容，還是無法下載的話請使用擴充程式嘗試。
        </p>
      </div>
      <form
        className="library-download-composer__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (url) createItem.mutate()
        }}
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="url"
          aria-label="單支影音網址"
          value={input}
          placeholder="https://www.youtube.com/watch?v=..."
          onChange={(event) => setInput(event.target.value)}
        />
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                type="submit"
                size="icon"
                aria-label="下載"
                disabled={createItem.isPending || !url}
              />
            )}
          >
            {createItem.isPending ? <Spinner /> : <DownloadIcon />}
          </TooltipTrigger>
          <TooltipContent>下載</TooltipContent>
        </Tooltip>
      </form>
      {createItem.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>無法下載影音</AlertTitle>
          <AlertDescription>{createItem.error.message}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function DownloadItemActions({ item }: { item: DownloadLibraryItem }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: "cancel" | "retry" | "approve" | "remove") => {
      if (action === "cancel") return api.cancelLibraryDownload(item.id)
      if (action === "approve") return api.approveLowQualityDownload(item.id)
      if (action === "remove") return api.removeLibraryDownload(item.id)
      return api.retryLibraryDownload(item.id)
    },
    onSuccess: (response) => {
      queryClient.setQueryData<LibraryResponse>(["library"], response)
    },
  })
  const sourceAction = (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            render={(
              <a href={item.pageUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only">開啟來源 {item.title}</span>
              </a>
            )}
            size="icon"
            variant="ghost"
            aria-label={`開啟來源 ${item.title}`}
          />
        )}
      >
      </TooltipTrigger>
      <TooltipContent>開啟來源</TooltipContent>
    </Tooltip>
  )
  if (item.state === "needs_confirmation") {
    return (
      <div className="library-download-actions">
        {sourceAction}
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
  const action = retryable ? "retry" : "cancel"
  const label = retryable ? `重新下載 ${item.title}` : `取消下載 ${item.title}`
  return (
    <div className="library-download-actions">
      {sourceAction}
      {retryable || cancellable ? (
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
      ) : null}
      {item.state === "failed" ? (
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                size="icon"
                variant="ghost"
                aria-label={`刪除下載失敗項目 ${item.title}`}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("remove")}
              />
            )}
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>刪除</TooltipContent>
        </Tooltip>
      ) : null}
      {mutation.isError ? <small role="alert">{mutation.error.message}</small> : null}
    </div>
  )
}

function DownloadRow({ item }: { item: DownloadLibraryItem }) {
  return (
    <TableRow>
      <TableCell data-label="影音">
        <div className="job-title-cell">
          <div className="job-thumbnail job-thumbnail--download">
            <DownloadProgressValue item={item} />
          </div>
          <div className="library-download-title">
            <strong title={item.title}>{item.title}</strong>
          </div>
        </div>
      </TableCell>
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
  const openDetails = async () => {
    await loadJobDetailDialog()
    actions.open({ type: "detail", videoId: job.videoId, tab: "about" })
  }
  return (
    <MediaCard
      job={job}
      actionLabel={job.watchable ? "觀看" : "查看"}
      onOpen={openJob}
    >
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button
              size="icon"
              variant="ghost"
              className="video-grid-card__settings"
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

export function LibraryDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "library" ? overlay.state : null
  const query = useLibraryQuery({ refreshDownloadQueue: active?.view === "list" })
  const items = query.data?.items ?? EMPTY_LIBRARY_ITEMS
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
      const sourceUrl =
        item.kind === "media"
          ? item.job.sourceUrl
          : item.kind === "download"
            ? item.pageUrl
            : item.originalName
      return (
        !normalized ||
        itemTitle(item).toLocaleLowerCase("zh-TW").includes(normalized) ||
        Boolean(videoId?.toLocaleLowerCase("en").includes(normalized)) ||
        Boolean(sourceUrl?.toLocaleLowerCase("en").includes(normalized))
      )
    })
  }, [items, search])
  const downloadItems = useMemo(
    () => items.filter((item): item is DownloadLibraryItem => item.kind === "download"),
    [items],
  )
  const totalMediaSize = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          item.kind === "media" ? total + item.job.sizeBytes : total,
        0,
      ),
    [items],
  )
  const feedback = (visibleCount: number) => (
    <>
      {query.isPending ? <LoadingState label="正在讀取影片中心" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.isSuccess && items.length === 0 ? (
        <EmptyState
          title="目前還沒有影音"
          description="可從下載佇列貼上網址，或使用上方匯入按鈕選取本機影音。"
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
      description="管理已完成的影音、遠端下載與本機匯入"
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
          <TabsTrigger value="list">下載佇列</TabsTrigger>
          <TabsTrigger value="subtitle-style">字幕樣式</TabsTrigger>
        </TabsList>

        <TabsContent
          value="grid"
          className="grouped-dialog-panel library-view-panel library-media-panel"
        >
          <div className="library-media-toolbar">
            <LibrarySearch
              className="library-media-search"
              value={search}
              onChange={(value) => updateLibrary({ query: value })}
            />
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`共 ${formatBytes(totalMediaSize)}`}
                  />
                )}
              >
                <HardDriveIcon />
              </TooltipTrigger>
              <TooltipContent>
                共 {formatBytes(totalMediaSize)}
              </TooltipContent>
            </Tooltip>
            <LocalMediaImportDialog />
          </div>
          <div className="library-media-scroll-region">
            {feedback(searched.length)}
            {searched.length > 0 ? (
              <div className="video-grid">
                {searched.map((item) =>
                  item.kind === "media" ? (
                    <MediaGridCard key={item.id} item={item} />
                  ) : item.kind === "download" ? (
                    <DownloadGridCard key={item.id} item={item} />
                  ) : (
                    <ImportMediaCard key={item.id} item={item} removable />
                  ),
                )}
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent
          value="list"
          className="grouped-dialog-panel library-view-panel library-details-panel"
        >
          <section className="library-panel" aria-label="下載佇列">
            <DownloadQueueForm />
            {query.isPending ? <LoadingState label="正在讀取下載佇列" /> : null}
            {query.isError ? <ErrorState message={query.error.message} /> : null}
            {query.data ? (
              <div className="job-table-frame">
                <Table className="job-table">
                  <colgroup>
                    <col className="video-column" />
                    <col className="action-column" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>影音</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {downloadItems.length > 0 ? (
                      downloadItems.map((item) => (
                        <DownloadRow key={item.id} item={item} />
                      ))
                    ) : (
                      <TableRow className="library-download-empty-row">
                        <TableCell colSpan={2}>
                          <EmptyState
                            title="目前沒有下載工作"
                            description="貼上影音網址，或從擴充功能送出下載。"
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </section>
        </TabsContent>

        <TabsContent
          value="subtitle-style"
          className="grouped-dialog-panel library-view-panel library-subtitle-style-panel"
        >
          <SubtitleStylePanel />
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
