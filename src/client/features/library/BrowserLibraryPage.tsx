import { LibraryBigIcon, PlayIcon, SearchIcon, XIcon } from "lucide-react"
import { useMemo, useState } from "react"

import birdImage from "@library-assets/taiwan-whistling-thrush.png"

import { CaptionLanguageSelect } from "@/components/shared/CaptionLanguageSelect"
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
import { DownloadMediaCard } from "@/features/library/DownloadMediaCard"
import { useLibraryQuery } from "@/hooks/use-library-query"
import { getJobPreferredCaption, NO_CAPTION } from "@/lib/captions"
import type { JobSummary } from "@shared/contracts/job"
import type { LibraryItem } from "@shared/contracts/library"

function BrowserMediaCard({
  job,
  onWatch,
}: {
  job: JobSummary
  onWatch: (caption: string) => void
}) {
  const [selectedCaption, setSelectedCaption] = useState(() =>
    getJobPreferredCaption(job),
  )
  const caption = job.captionCodes.includes(selectedCaption)
    ? selectedCaption
    : getJobPreferredCaption(job)
  return (
    <MediaCard
      job={job}
      actionLabel={job.watchable ? "觀看" : "尚未可觀看"}
      onOpen={() => (job.watchable ? onWatch(caption) : undefined)}
    >
      <div className="browser-media-card__controls">
        <CaptionLanguageSelect
          codes={job.captionCodes}
          value={caption}
          onValueChange={setSelectedCaption}
          label={`${job.title} 字幕`}
        />
        <Button
          size="icon"
          disabled={!job.watchable}
          aria-label={`觀看 ${job.title}`}
          onClick={() => onWatch(caption)}
        >
          <PlayIcon aria-hidden="true" />
        </Button>
      </div>
    </MediaCard>
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
  const items = query.data?.items ?? []
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-TW")
    return items.filter((item) => {
      const title = item.kind === "media" ? item.job.title : item.title
      const videoId = item.kind === "media" ? item.job.videoId : item.videoId
      const sourceUrl = item.kind === "media" ? item.job.sourceUrl : item.pageUrl
      return (
        !term ||
        title.toLocaleLowerCase("zh-TW").includes(term) ||
        Boolean(videoId?.toLocaleLowerCase("en").includes(term)) ||
        sourceUrl.toLocaleLowerCase("en").includes(term)
      )
    })
  }, [items, search])

  return (
    <div className="browser-library-shell">
      <header className="browser-library-header">
        <a href="/extension/library" className="brand" aria-label="INSU Player Chrome 影音頁">
          <img src={birdImage} alt="" />
          <strong>INSU PLAYER</strong>
        </a>
        <span>
          <LibraryBigIcon aria-hidden="true" />
          Chrome 影音頁
        </span>
      </header>
      <main className="browser-library-main">
        <div className="browser-library-heading">
          <span>LOCAL LIBRARY</span>
          <h1>我的影音</h1>
          <p>這裡只提供觀看與字幕選擇。需要內容處理時，請回到 Codex 與 Agent 對話。</p>
        </div>
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
        {query.isSuccess && items.length === 0 ? (
          <EmptyState
            title="目前還沒有影音"
            description="從 Chrome 擴充功能加入影音後，下載工作會出現在這裡。"
          />
        ) : null}
        {query.isSuccess && items.length > 0 && filtered.length === 0 ? (
          <EmptyState title="找不到影音" description="請調整搜尋字詞。" />
        ) : null}
        {filtered.length > 0 ? (
          <div className="video-grid browser-video-grid">
            {filtered.map((item: LibraryItem) =>
              item.kind === "media" ? (
                <BrowserMediaCard
                  key={item.id}
                  job={item.job}
                  onWatch={(caption) => setPlayer({ job: item.job, caption })}
                />
              ) : (
                <DownloadMediaCard key={item.id} item={item} />
              ),
            )}
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
