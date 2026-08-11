import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  BanIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "@/api/client"
import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { TutorialCard } from "@/components/shared/prompt-cards/TutorialCard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useJobsQuery } from "@/hooks/use-jobs-query"
import type {
  DownloadBatch,
  DownloadBatchItem,
} from "@shared/contracts/download-batch"
import { buildDownloadedMediaPrompt } from "@shared/prompts/insu-prompts"

const ACTIVE_STATES = new Set([
  "checking",
  "queued",
  "downloading",
  "verifying",
  "needs_confirmation",
])

const STATUS_LABELS: Record<DownloadBatchItem["state"], string> = {
  checking: "檢查中",
  queued: "等待下載",
  downloading: "下載中",
  verifying: "驗證中",
  downloaded: "已下載",
  needs_confirmation: "需要確認",
  cancelled: "已取消",
  failed: "下載失敗",
}

function parseUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function BatchItemActions({
  batch,
  item,
}: {
  batch: DownloadBatch
  item: DownloadBatchItem
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (operation: "cancel" | "retry" | "approve") => {
      if (operation === "cancel") {
        return api.cancelDownloadBatchItem(batch.id, item.id)
      }
      return api.retryDownloadBatchItem(
        batch.id,
        item.id,
        operation === "approve",
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["download-batches"] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
    },
  })
  const action = (() => {
    if (["queued", "downloading"].includes(item.state)) {
      return (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="取消下載"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("cancel")}
        >
          {mutation.isPending ? <Spinner /> : <BanIcon />}
        </Button>
      )
    }
    if (item.state === "needs_confirmation") {
      return (
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("approve")}
        >
          {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
          同意低於 720p
        </Button>
      )
    }
    if (["failed", "cancelled"].includes(item.state)) {
      return (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="重新下載"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("retry")}
        >
          {mutation.isPending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      )
    }
    return null
  })()
  return (
    <div className="download-queue-action-stack">
      {action}
      {mutation.isError ? (
        <small role="alert">{mutation.error.message}</small>
      ) : null}
    </div>
  )
}

function DownloadQueueTable({ batch }: { batch: DownloadBatch }) {
  const queryClient = useQueryClient()
  const scheduling = useMutation({
    mutationFn: () =>
      batch.state === "paused"
        ? api.resumeDownloadBatch(batch.id)
        : api.pauseDownloadBatch(batch.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["download-batches"] })
    },
  })
  return (
    <section className="download-queue-section" aria-label="影音下載佇列">
      <div className="download-queue-heading">
        <div>
          <strong>下載佇列</strong>
          <small>
            {batch.state === "paused"
              ? "已暫停送出新的下載，正在進行的下載不會被中斷"
              : batch.state === "complete"
                ? "本批次已完成"
                : "依序下載並驗證最高可用畫質"}
          </small>
        </div>
        {batch.state !== "complete" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={scheduling.isPending}
            onClick={() => scheduling.mutate()}
          >
            {batch.state === "paused" ? (
              <PlayIcon data-icon="inline-start" />
            ) : (
              <PauseIcon data-icon="inline-start" />
            )}
            {batch.state === "paused" ? "繼續排程" : "暫停排程"}
          </Button>
        ) : null}
      </div>
      <div className="download-queue-table-region">
        <Table className="download-queue-table">
          <TableHeader>
            <TableRow>
              <TableHead>影音網址</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>進度</TableHead>
              <TableHead className="download-queue-actions-column">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="download-queue-source">
                    <strong>{item.videoId ?? `項目 ${item.ordinal + 1}`}</strong>
                    <small>{item.sourceUrl}</small>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      item.state === "failed"
                        ? "destructive"
                        : item.state === "downloaded"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {STATUS_LABELS[item.state]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {ACTIVE_STATES.has(item.state) && item.state !== "needs_confirmation" ? (
                    <div className="download-queue-progress">
                      <Progress value={item.progress} />
                      <small>{item.message}</small>
                    </div>
                  ) : (
                    <span>{item.message}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="download-queue-actions">
                    <BatchItemActions batch={batch} item={item} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function AddMediaDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "add-media" ? overlay.state : null
  const selectTab = (tab: "sources" | "downloads" | "handoff") => {
    overlay.actions.open({ type: "add-media", tab })
  }
  const queryClient = useQueryClient()
  const [input, setInput] = useState("")
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const jobs = useJobsQuery()
  const urls = useMemo(() => parseUrls(input), [input])
  const batches = useQuery({
    queryKey: ["download-batches"],
    queryFn: api.downloadBatches,
    enabled: Boolean(active),
    refetchInterval: (query) =>
      query.state.data?.batches.some((batch) => batch.state !== "complete")
        ? 1_000
        : false,
  })
  const createBatch = useMutation({
    mutationFn: () =>
      api.createDownloadBatch(
        urls.map((pageUrl) => ({ kind: "page" as const, pageUrl })),
        true,
      ),
    onSuccess: (response) => {
      setSelectedBatchId(response.batch.id)
      setInput("")
      setRightsConfirmed(false)
      void queryClient.invalidateQueries({ queryKey: ["download-batches"] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
      selectTab("downloads")
      return response
    },
  })
  const displayedBatch =
    batches.data?.batches.find((batch) => batch.id === selectedBatchId) ??
    batches.data?.batches.find((batch) => batch.state === "active") ??
    batches.data?.batches[0]
  const waitingVideoIds = new Set(
    jobs.data?.jobs
      .filter((job) => job.state === "downloaded")
      .map((job) => job.videoId) ?? [],
  )
  const downloadedVideoIds = [
    ...new Set(
      batches.data?.batches.flatMap((batch) =>
        batch.items.flatMap((item) =>
          item.state === "downloaded" &&
          item.videoId &&
          waitingVideoIds.has(item.videoId)
            ? [item.videoId]
            : [],
        ),
      ) ?? [],
    ),
  ]
  const prompt = downloadedVideoIds.length
    ? buildDownloadedMediaPrompt(downloadedVideoIds)
    : "目前沒有等待字幕處理的影音。"

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => (open ? undefined : overlay.actions.close("add-media"))}
      kicker="ADD MEDIA"
      title="加入影音"
      description="批次加入單支影音網址並直接下載到目前影音庫"
      size="screen"
      height="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs add-media-tabs"
        value={active?.tab ?? "sources"}
        onValueChange={(value) =>
          selectTab(value as "sources" | "downloads" | "handoff")
        }
      >
        <TabsList variant="line" aria-label="加入影音分頁">
          <TabsTrigger value="sources">1 加入影音</TabsTrigger>
          <TabsTrigger value="downloads">2 下載進度</TabsTrigger>
          <TabsTrigger value="handoff">3 交給 Agent</TabsTrigger>
        </TabsList>
        <TabsContent value="sources" className="grouped-dialog-panel">
          {active?.tab === "sources" ? (
            <div className="guide-tab-content">
              <TutorialCard
                kicker="01 / ADD"
                title="加入要下載的影音"
                description="每行貼上一個單支影音網址，確認你有權處理後再建立下載佇列。"
                footer={(
                  <Button
                    type="submit"
                    form="add-media-source-form"
                    disabled={
                      createBatch.isPending ||
                      !rightsConfirmed ||
                      urls.length === 0 ||
                      urls.length > 50
                    }
                  >
                    {createBatch.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <DownloadIcon data-icon="inline-start" />
                    )}
                    {createBatch.isPending
                      ? "正在建立下載佇列"
                      : urls.length
                        ? `送出 ${urls.length} 個影音`
                        : "建立下載佇列"}
                    {!createBatch.isPending ? (
                      <ArrowRightIcon data-icon="inline-end" />
                    ) : null}
                  </Button>
                )}
              >
                <form
                  id="add-media-source-form"
                  className="add-media-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (urls.length && rightsConfirmed) createBatch.mutate()
                  }}
                >
                  <FieldGroup>
                    <Field data-invalid={urls.length > 50 || undefined}>
                      <FieldLabel htmlFor="media-urls">單支影音網址</FieldLabel>
                      <FieldDescription>
                        每行貼上一個網址，最多 50 個。播放清單不會被展開。
                      </FieldDescription>
                      <Textarea
                        id="media-urls"
                        value={input}
                        rows={5}
                        placeholder="https://www.youtube.com/watch?v=..."
                        aria-invalid={urls.length > 50 || undefined}
                        onChange={(event) => setInput(event.target.value)}
                      />
                      {urls.length > 50 ? (
                        <FieldError>每批最多 50 個網址</FieldError>
                      ) : null}
                    </Field>
                    <Field orientation="horizontal">
                      <Checkbox
                        id="media-rights"
                        checked={rightsConfirmed}
                        onCheckedChange={(checked) =>
                          setRightsConfirmed(checked === true)
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor="media-rights">
                          我確認這些是我自己的內容，或我已取得下載、轉錄與觀看的權利
                        </FieldLabel>
                        <FieldDescription>
                          系統不會繞過 DRM、付費牆、會員或私人存取限制。
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldGroup>
                  {createBatch.isError ? (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>無法建立下載佇列</AlertTitle>
                      <AlertDescription>{createBatch.error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </form>
              </TutorialCard>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="downloads" className="grouped-dialog-panel">
          {active?.tab === "downloads" ? (
            <div className="guide-tab-content">
              <TutorialCard
                kicker="02 / DOWNLOAD"
                title="查看下載進度"
                description="系統會依序下載並驗證最高可用畫質，完成的影音可以交給 Agent 接續處理字幕。"
                footer={downloadedVideoIds.length > 0 ? (
                  <Button onClick={() => selectTab("handoff")}>
                    前往交給 Agent
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                ) : undefined}
              >
                {batches.isPending ? (
                  <LoadingState label="正在讀取下載佇列" />
                ) : null}
                {batches.isError ? (
                  <ErrorState message={batches.error.message} />
                ) : null}
                {displayedBatch ? (
                  <DownloadQueueTable batch={displayedBatch} />
                ) : !batches.isPending && !batches.isError ? (
                  <Alert>
                    <DownloadIcon />
                    <AlertTitle>還沒有下載工作</AlertTitle>
                    <AlertDescription>
                      回到第一步貼上影音網址並建立下載佇列。
                    </AlertDescription>
                  </Alert>
                ) : null}
              </TutorialCard>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="handoff" className="grouped-dialog-panel">
          {active?.tab === "handoff" ? (
            <div className="guide-tab-content">
              <PromptActionCard
                kicker="03 / AGENT"
                title="請 Agent 接續處理字幕"
                description="複製提示，讓 Agent 從已下載影音的原始音訊建立時間軸，再完成校正或翻譯與字幕切分。"
                prompt={prompt}
                copyDisabled={downloadedVideoIds.length === 0}
                footer={downloadedVideoIds.length === 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => selectTab("downloads")}
                  >
                    回到下載進度
                  </Button>
                ) : undefined}
              >
                <div className="downloaded-media-summary">
                  <ShieldCheckIcon aria-hidden="true" />
                  <span>{downloadedVideoIds.length} 支影音等待字幕處理</span>
                </div>
              </PromptActionCard>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
