import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  DownloadIcon,
  FilmIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "@/api/client"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { ResourceRemovalDialog } from "@/components/shared/removal/ResourceRemovalDialog"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMediaCatalog } from "@/hooks/use-media-catalog"
import type { JobDetail } from "@shared/contracts/job"
import type {
  MediaCatalogResponse,
  MediaDownloadResponse,
  MediaRendition,
  MediaSourceFormat,
} from "@shared/contracts/media"
import { formatBytes, formatDate } from "@shared/domain/format"

const ACTIVE_STATES = new Set([
  "discovering",
  "probing",
  "downloading",
  "merging",
  "validating",
])

function qualityLabel(height: number) {
  return `${height}p`
}

function codecLabel(rendition: MediaRendition) {
  return [rendition.container.toUpperCase(), rendition.videoCodec, rendition.audioCodec]
    .filter(Boolean)
    .join(" · ")
}

function DownloadRenditionDialog({
  videoId,
  format,
  disabled,
  onStarting,
  onAccepted,
}: {
  videoId: string
  format: MediaSourceFormat
  disabled: boolean
  onStarting: () => Promise<void>
  onAccepted: (response: MediaDownloadResponse) => void
}) {
  const [open, setOpen] = useState(false)
  const download = useMutation({
    mutationFn: async () => {
      await onStarting()
      return api.downloadMedia(videoId, format.height)
    },
    onSuccess: (response) => {
      setOpen(false)
      onAccepted(response)
    },
  })
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (download.isPending) return
        setOpen(nextOpen)
        if (nextOpen) download.reset()
      }}
    >
      <AlertDialogTrigger
        render={
          <Button size="sm" disabled={disabled}>
            <DownloadIcon data-icon="inline-start" />
            下載
          </Button>
        }
      />
      <AlertDialogContent overlayEmphasis="strong">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <DownloadIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>
            下載 {qualityLabel(format.height)} 到影音庫
          </AlertDialogTitle>
          <AlertDialogDescription>
            {format.estimatedBytes
              ? `來源預估約 ${formatBytes(format.estimatedBytes)}，下載前會檢查可用空間，完成並驗證後才會加入可播放畫質。`
              : "來源未提供容量估算，完成並驗證後才會加入可播放畫質。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {download.isError ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>無法開始下載</AlertTitle>
            <AlertDescription>{download.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={download.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            {download.isPending ? <Spinner data-icon="inline-start" /> : null}
            {download.isPending ? "正在建立工作" : "下載到影音庫"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function MediaRenditionRemovalDialog({
  videoId,
  rendition,
  onRemoved,
}: {
  videoId: string
  rendition: MediaRendition
  onRemoved: () => void
}) {
  return (
    <ResourceRemovalDialog
      target={{ kind: "media-rendition", videoId, renditionId: rendition.id }}
      title={`移除 ${qualityLabel(rendition.height)} 畫質`}
      description="這只會移除選取的本地畫質，其他畫質、字幕與影音資料都會保留。"
      confirmLabel="移除畫質"
      onRemoved={onRemoved}
    >
      <Button
        variant="destructive"
        size="icon-sm"
        aria-label={`移除 ${qualityLabel(rendition.height)} 畫質`}
      >
        <Trash2Icon />
      </Button>
    </ResourceRemovalDialog>
  )
}

function QualityStatus({
  catalog,
  rendition,
  height,
}: {
  catalog: MediaCatalogResponse
  rendition: MediaRendition | undefined
  height: number
}) {
  const operation = catalog.operation
  if (
    operation?.requestedHeight === height &&
    ACTIVE_STATES.has(operation.state)
  ) {
    return (
      <div className="media-quality-progress">
        <div className="media-quality-progress__label">
          <span>{operation.message}</span>
          <span>{`${Math.round(operation.progress)}%`}</span>
        </div>
        <Progress value={operation.progress} />
      </div>
    )
  }
  if (rendition?.active) return <Badge>目前播放</Badge>
  if (rendition) return <Badge variant="secondary">已下載</Badge>
  if (operation?.requestedHeight === height && operation.state === "failed") {
    return <Badge variant="destructive">下載失敗</Badge>
  }
  return <Badge variant="outline">可下載</Badge>
}

export function MediaQualityPanel({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient()
  const catalog = useMediaCatalog(job.videoId)
  const mediaQueryKey = ["job-media", job.videoId] as const
  const refresh = useMutation({
    mutationFn: () => api.refreshMedia(job.videoId),
    onSuccess: (data) => {
      queryClient.setQueryData(["job-media", job.videoId], data)
    },
  })
  const activate = useMutation({
    mutationFn: (renditionId: string) =>
      api.activateMedia(job.videoId, renditionId),
    onSuccess: (data) => {
      queryClient.setQueryData(["job-media", job.videoId], data)
      void queryClient.invalidateQueries({ queryKey: ["job", job.videoId] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
    },
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: mediaQueryKey })
    void queryClient.invalidateQueries({ queryKey: ["job", job.videoId] })
    void queryClient.invalidateQueries({ queryKey: ["jobs"] })
  }

  const acceptDownload = (response: MediaDownloadResponse) => {
    queryClient.setQueryData<MediaCatalogResponse>(mediaQueryKey, (current) =>
      current ? { ...current, operation: response.operation } : current,
    )
    void queryClient.refetchQueries({ queryKey: mediaQueryKey, type: "active" })
    void queryClient.invalidateQueries({ queryKey: ["job", job.videoId] })
    void queryClient.invalidateQueries({ queryKey: ["jobs"] })
  }

  const rows = useMemo(() => {
    if (!catalog.data) return []
    const heights = new Set([
      ...catalog.data.formats.map((format) => format.height),
      ...catalog.data.renditions.map((rendition) => rendition.height),
    ])
    return [...heights]
      .sort((left, right) => right - left)
      .map((height) => ({
        height,
        format: catalog.data!.formats.find((item) => item.height === height),
        rendition: catalog.data!.renditions.find((item) => item.height === height),
      }))
  }, [catalog.data])

  if (catalog.isPending) return <LoadingState label="正在讀取可用畫質" />
  if (catalog.isError) return <ErrorState message={catalog.error.message} />
  if (!catalog.data) return null

  const active = catalog.data.renditions.find((rendition) => rendition.active)
  const operationActive = Boolean(
    catalog.data.operation && ACTIVE_STATES.has(catalog.data.operation.state),
  )

  return (
    <div className="media-quality-workspace">
      {active ? (
        <Card size="sm" className="media-quality-current">
          <CardHeader>
            <CardTitle>{qualityLabel(active.height)}</CardTitle>
            <CardDescription>
              {active.width} × {active.height} · {codecLabel(active)}
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                disabled={refresh.isPending || operationActive}
                onClick={() => refresh.mutate()}
              >
                {refresh.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                {refresh.isPending ? "正在檢查" : "重新檢查畫質"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="media-quality-current__facts">
            <span>{formatBytes(active.sizeBytes)}</span>
            <span>{formatDate(active.createdAt)}</span>
            <span>{catalog.data.renditions.length} 個本地畫質</span>
            <span>
              {catalog.data.availableBytes === null
                ? "可用空間未知"
                : `可用 ${formatBytes(catalog.data.availableBytes)}`}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {refresh.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>無法更新來源畫質</AlertTitle>
          <AlertDescription>{refresh.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {catalog.data.operation?.state === "failed" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>畫質下載失敗</AlertTitle>
          <AlertDescription>
            {catalog.data.operation.error || catalog.data.operation.message}
          </AlertDescription>
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <Table
          className="detail-table media-quality-table"
          containerClassName="detail-table-frame media-quality-table-frame"
        >
          <TableHeader>
            <TableRow>
              <TableHead>畫質</TableHead>
              <TableHead>容量</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="detail-table__action-cell media-quality-table__actions">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ height, format, rendition }) => {
              const downloading = Boolean(
                catalog.data.operation?.requestedHeight === height &&
                  ACTIVE_STATES.has(catalog.data.operation.state),
              )
              return (
                <TableRow key={height}>
                  <TableCell>
                    <div className="media-quality-name">
                      <strong>{qualityLabel(height)}</strong>
                      <small>
                        {rendition
                          ? `${rendition.width} × ${rendition.height} · ${codecLabel(rendition)}`
                          : [format?.container.toUpperCase(), format?.videoCodec]
                              .filter(Boolean)
                              .join(" · ")}
                      </small>
                    </div>
                  </TableCell>
                  <TableCell>
                    {rendition
                      ? formatBytes(rendition.sizeBytes)
                      : format?.estimatedBytes
                        ? `約 ${formatBytes(format.estimatedBytes)}`
                        : "—"}
                  </TableCell>
                  <TableCell>
                    <QualityStatus
                      catalog={catalog.data}
                      rendition={rendition}
                      height={height}
                    />
                  </TableCell>
                  <TableCell className="detail-table__action-cell media-quality-table__actions">
                    <div className="detail-table__action-group media-quality-actions">
                      {rendition && !rendition.active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activate.isPending || operationActive}
                          onClick={() => activate.mutate(rendition.id)}
                        >
                          <PlayIcon data-icon="inline-start" />
                          設為播放
                        </Button>
                      ) : null}
                      {rendition?.active ? (
                        <span className="media-quality-active-label">
                          <CheckCircle2Icon aria-hidden="true" />
                          使用中
                        </span>
                      ) : null}
                      {!rendition && format && !downloading ? (
                        <DownloadRenditionDialog
                          videoId={job.videoId}
                          format={format}
                          disabled={operationActive}
                          onStarting={() =>
                            queryClient.cancelQueries({ queryKey: mediaQueryKey })
                          }
                          onAccepted={acceptDownload}
                        />
                      ) : null}
                      {downloading ? (
                        <Button size="sm" disabled>
                          <Spinner data-icon="inline-start" />
                          下載中
                        </Button>
                      ) : null}
                      {rendition && !rendition.active ? (
                        <MediaRenditionRemovalDialog
                          videoId={job.videoId}
                          rendition={rendition}
                          onRemoved={invalidate}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilmIcon />
            </EmptyMedia>
            <EmptyTitle>尚未取得可用畫質</EmptyTitle>
            <EmptyDescription>
              重新檢查來源後，這裡會列出可直接下載到影音庫的畫質。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
