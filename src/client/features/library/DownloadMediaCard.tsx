import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { DownloadLibraryItem } from "@shared/contracts/library"

export function DownloadProgressValue({ item }: { item: DownloadLibraryItem }) {
  const progress = Number.isFinite(item.progress)
    ? Math.min(100, Math.max(0, Math.round(item.progress)))
    : 0
  return (
    <span className="download-progress-value" aria-label={`下載進度 ${progress}%`}>
      {progress}%
    </span>
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
        <DownloadProgressValue item={item} />
      </div>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} title={item.title}>
          {item.title}
        </CardTitle>
      </CardHeader>
      {children ? <CardFooter>{children}</CardFooter> : null}
    </Card>
  )
}
