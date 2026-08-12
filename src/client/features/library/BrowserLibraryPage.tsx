import { SearchIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"

import birdImage from "@library-assets/taiwan-whistling-thrush.png"

import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MediaCard } from "@/features/library/MediaCard"
import { useLibraryQuery } from "@/hooks/use-library-query"
import { getJobPreferredCaption, NO_CAPTION } from "@/lib/captions"
import type { JobSummary } from "@shared/contracts/job"
import type { LibraryItem, MediaLibraryItem } from "@shared/contracts/library"

const EMPTY_LIBRARY_ITEMS: LibraryItem[] = []

function BrowserMediaCard({
  job,
  onWatch,
}: {
  job: JobSummary
  onWatch: () => void
}) {
  return (
    <MediaCard
      job={job}
      actionLabel={job.watchable ? "觀看" : "尚未可觀看"}
      onOpen={() => (job.watchable ? onWatch() : undefined)}
    />
  )
}

function BrowserPlayer({
  job,
  caption,
  onClose,
}: {
  job: JobSummary
  caption: string
  onClose: () => void
}) {
  const query = new URLSearchParams({ embed: "1" })
  if (caption !== NO_CAPTION) query.set("caption", caption)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="browser-player-dialog" showCloseButton={false}>
        <DialogHeader className="browser-player-dialog__header">
          <div>
            <span>LOCAL PLAYER</span>
            <DialogTitle>{job.title}</DialogTitle>
            <DialogDescription className="sr-only">
              播放本機影音並使用選取的字幕
            </DialogDescription>
          </div>
          <Button size="icon" variant="ghost" aria-label="關閉播放器" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </Button>
        </DialogHeader>
        <iframe
          title={job.title}
          src={`/watch/${encodeURIComponent(job.videoId)}/?${query.toString()}`}
          allow="autoplay; fullscreen"
          sandbox="allow-scripts"
        />
      </DialogContent>
    </Dialog>
  )
}

export function BrowserLibraryPage() {
  const query = useLibraryQuery()
  const [search, setSearch] = useState("")
  const [player, setPlayer] = useState<{
    job: JobSummary
    caption: string
  } | null>(null)
  const items = query.data?.items ?? EMPTY_LIBRARY_ITEMS
  const mediaItems = useMemo(
    () => items.filter((item): item is MediaLibraryItem => item.kind === "media"),
    [items],
  )
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-TW")
    return mediaItems.filter((item) => {
      const { title, videoId, sourceUrl } = item.job
      return (
        !term ||
        title.toLocaleLowerCase("zh-TW").includes(term) ||
        Boolean(videoId?.toLocaleLowerCase("en").includes(term)) ||
        Boolean(sourceUrl?.toLocaleLowerCase("en").includes(term))
      )
    })
  }, [mediaItems, search])

  return (
    <div className="browser-library-shell">
      <header className="browser-library-header">
        <a href="/extension/library" className="brand" aria-label="INSU Player">
          <img src={birdImage} alt="" />
          <strong>INSU PLAYER</strong>
        </a>
      </header>
      <main className="browser-library-main">
        <label className="search-control browser-library-search">
          <span className="sr-only">搜尋影音</span>
          <SearchIcon aria-hidden="true" />
          <Input
            type="search"
            placeholder="搜尋標題或影音 ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {query.isPending ? <LoadingState label="正在讀取影音" /> : null}
        {query.isError ? <ErrorState message={query.error.message} /> : null}
        {query.isSuccess && mediaItems.length === 0 ? (
          <EmptyState
            title="目前還沒有影音"
            description="從 Chrome 擴充功能加入影音後，完成下載才會出現在這裡。"
          />
        ) : null}
        {query.isSuccess && mediaItems.length > 0 && filtered.length === 0 ? (
          <EmptyState title="找不到影音" description="請調整搜尋字詞。" />
        ) : null}
        {filtered.length > 0 ? (
          <div className="video-grid browser-video-grid">
            {filtered.map((item) => (
              <BrowserMediaCard
                key={item.id}
                job={item.job}
                onWatch={() =>
                  setPlayer({
                    job: item.job,
                    caption: getJobPreferredCaption(item.job),
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </main>
      {player ? (
        <BrowserPlayer
          job={player.job}
          caption={player.caption}
          onClose={() => setPlayer(null)}
        />
      ) : null}
    </div>
  )
}
