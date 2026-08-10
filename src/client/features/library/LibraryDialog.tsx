import {
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

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
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  VideoCardRemovalDialog,
  VideoListRemovalDialog,
} from "@/features/job-detail/VideoRemovalDialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useJobsQuery } from "@/hooks/use-jobs-query"
import { getJobPreferredCaption, NO_CAPTION } from "@/lib/captions"
import { cn } from "@/lib/utils"
import type { JobSummary } from "@shared/contracts/job"
import { ACTIVE_STATES, ATTENTION_STATES } from "@shared/domain/job-status"
import { formatBytes, formatDuration } from "@shared/domain/format"

type Filter = "all" | "active" | "attention" | "watchable" | "ready"
const FILTERS = [
  { value: "all", label: "全部狀態" },
  { value: "active", label: "處理中" },
  { value: "attention", label: "需要處理" },
  { value: "watchable", label: "可觀看" },
  { value: "ready", label: "已完成" },
]
const EMPTY_JOBS: JobSummary[] = []

function matchesFilter(job: JobSummary, filter: Filter) {
  const state = job.effectiveState || job.state
  if (filter === "active") return ACTIVE_STATES.has(state)
  if (filter === "attention") return ATTENTION_STATES.has(state)
  if (filter === "watchable") return job.watchable
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
        placeholder="搜尋標題或影音 ID"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function JobRow({ job }: { job: JobSummary }) {
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
              render={
                <Button
                  size="icon"
                  disabled={!job.watchable}
                  aria-label={`觀看 ${job.title}`}
                  onPointerEnter={() => void loadPlayerDialog()}
                  onFocus={() => void loadPlayerDialog()}
                  onPointerDown={() => void loadPlayerDialog()}
                  onClick={openPlayer}
                />
              }
            >
              <PlayIcon data-icon="inline-start" />
            </TooltipTrigger>
            <TooltipContent>觀看</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`設定 ${job.title}`}
                  onPointerEnter={() => void loadJobDetailDialog()}
                  onFocus={() => void loadJobDetailDialog()}
                  onPointerDown={() => void loadJobDetailDialog()}
                  onClick={openDetails}
                />
              }
            >
              <SettingsIcon data-icon="inline-start" />
            </TooltipTrigger>
            <TooltipContent>設定</TooltipContent>
          </Tooltip>
          <VideoListRemovalDialog videoId={job.videoId} title={job.title} />
        </div>
      </TableCell>
    </TableRow>
  )
}

function JobGridCard({ job }: { job: JobSummary }) {
  const { actions } = useOverlay()
  const caption = getJobPreferredCaption(job)
  const duration = formatDuration(job.durationSeconds)
  const loadJobDialog = job.watchable
    ? loadPlayerDialog
    : loadJobDetailDialog
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
    <Card className="video-grid-card" size="sm">
      <Button
        variant="ghost"
        className="video-grid-card__action"
        aria-label={`${job.watchable ? "觀看" : "查看"} ${job.title}`}
        onPointerEnter={() => void loadJobDialog()}
        onFocus={() => void loadJobDialog()}
        onPointerDown={() => void loadJobDialog()}
        onClick={openJob}
      >
        <div className="video-grid-card__thumbnail">
          {job.thumbnailUrl ? (
            <img src={job.thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <span>INSU</span>
          )}
          {duration ? (
            <Badge
              aria-hidden="true"
              className="video-grid-card__duration"
              variant="secondary"
            >
              {duration}
            </Badge>
          ) : null}
        </div>
        <CardHeader>
          <CardTitle role="heading" aria-level={4} title={job.title}>
            {job.title}
          </CardTitle>
        </CardHeader>
      </Button>
      <VideoCardRemovalDialog videoId={job.videoId} title={job.title} />
    </Card>
  )
}

function Metrics({ jobs }: { jobs: JobSummary[] }) {
  const totalSize = jobs.reduce((sum, job) => sum + job.sizeBytes, 0)
  const metrics = [
    ["全部項目", jobs.length, "ARCHIVE"],
    [
      "處理中",
      jobs.filter((job) => ACTIVE_STATES.has(job.effectiveState || job.state)).length,
      "IN FLIGHT",
    ],
    [
      "需要處理",
      jobs.filter((job) => ATTENTION_STATES.has(job.effectiveState || job.state)).length,
      "ATTENTION",
    ],
    ["可觀看", jobs.filter((job) => job.watchable).length, "SCREENABLE"],
    ["媒體容量", formatBytes(totalSize), "LOCAL STORAGE"],
  ] as const
  return (
    <section className="metrics" aria-label="影音中心摘要">
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
  const query = useJobsQuery()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const jobs = query.data?.jobs ?? EMPTY_JOBS
  const active = overlay.state?.type === "library" ? overlay.state : null
  const selectedView = active?.view ?? (jobs.length > 0 ? "grid" : "list")
  const searched = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("zh-TW")
    return jobs.filter(
      (job) =>
        !normalized ||
          job.title.toLocaleLowerCase("zh-TW").includes(normalized) ||
          job.videoId.toLocaleLowerCase("en").includes(normalized),
    )
  }, [jobs, search])
  const filtered = useMemo(
    () => searched.filter((job) => matchesFilter(job, filter)),
    [filter, searched],
  )
  const feedback = (visibleCount: number) => (
    <>
      {query.isPending ? <LoadingState label="正在讀取影音中心" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.isSuccess && jobs.length === 0 ? (
        <EmptyState
          title="目前還沒有影音"
          description="把影音網址交給 Agent，任務建立後會自動出現在這裡。"
        />
      ) : null}
      {query.isSuccess && jobs.length > 0 && visibleCount === 0 ? (
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
      title="影音中心"
      description="瀏覽我的影音，或查看處理狀態與字幕詳細資訊"
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
          })
        }
      >
        <TabsList variant="line" aria-label="影音中心分頁">
          <TabsTrigger value="grid">我的影音</TabsTrigger>
          <TabsTrigger value="list">詳細資訊</TabsTrigger>
        </TabsList>

        <TabsContent
          value="grid"
          className="grouped-dialog-panel library-view-panel library-media-panel"
        >
          <LibrarySearch
            className="library-media-search"
            value={search}
            onChange={setSearch}
          />
          {feedback(searched.length)}
          {searched.length > 0 ? (
            <div className="video-grid">
              {searched.map((job) => (
                <JobGridCard key={job.videoId} job={job} />
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent
          value="list"
          className="grouped-dialog-panel library-view-panel library-details-panel"
        >
          {query.data ? <Metrics jobs={jobs} /> : null}
          <section className="library-panel" aria-label="影音詳細資訊">
            <div className="library-toolbar">
              <div className="library-toolbar__controls">
                <LibrarySearch value={search} onChange={setSearch} />
                <Select
                  items={FILTERS}
                  value={filter}
                  onValueChange={(value) => setFilter(value as Filter)}
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
                  <RefreshCwIcon data-icon="inline-start" />
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
                    {filtered.map((job) => (
                      <JobRow key={job.videoId} job={job} />
                    ))}
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
