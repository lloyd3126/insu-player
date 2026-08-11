import { DownloadIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import type { DownloadLibraryItem } from "@shared/contracts/library"

const ACTIVE_DOWNLOAD_STATES = new Set([
  "checking",
  "queued",
  "downloading",
  "verifying",
])

export const DOWNLOAD_STATE_LABELS: Record<DownloadLibraryItem["state"], string> = {
  checking: "檢查來源",
  queued: "等待下載",
  downloading: "下載中",
  verifying: "驗證中",
  downloaded: "已下載",
  needs_confirmation: "需要確認畫質",
  cancelled: "已取消",
  failed: "下載失敗",
}

export function DownloadItemProgress({ item }: { item: DownloadLibraryItem }) {
  const detail =
    item.state === "queued" && item.queueAhead !== null
      ? item.queueAhead === 0
        ? "下一個開始下載"
        : `前面還有 ${item.queueAhead} 個影音`
      : item.message
  return (
    <div className="library-download-status">
      <div className="library-download-status__heading">
        <Badge
          variant={
            item.state === "failed"
              ? "destructive"
              : item.state === "downloaded"
                ? "secondary"
                : "outline"
          }
        >
          {DOWNLOAD_STATE_LABELS[item.state]}
        </Badge>
        <small>{detail}</small>
      </div>
      {ACTIVE_DOWNLOAD_STATES.has(item.state) && item.state !== "queued" ? (
        <Progress value={item.progress}>
          <ProgressLabel className="sr-only">{detail}</ProgressLabel>
          <ProgressValue />
        </Progress>
      ) : null}
    </div>
  )
}

export function DownloadMediaCard({
  item,
  children,
}: {
  item: DownloadLibraryItem
  children?: React.ReactNode
}) {
  return (
    <Card className="video-grid-card video-grid-card--download" size="sm">
      <div className="video-grid-card__thumbnail video-grid-card__thumbnail--download">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
      </div>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} title={item.title}>
          {item.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DownloadItemProgress item={item} />
      </CardContent>
      {children ? <CardFooter>{children}</CardFooter> : null}
    </Card>
  )
}
