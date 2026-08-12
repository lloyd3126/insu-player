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
