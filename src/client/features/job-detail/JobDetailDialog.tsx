import { useOverlay, type JobDetailTab } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JobAboutPanel } from "@/features/job-detail/JobAboutPanel"
import { JobActivityPanel } from "@/features/job-detail/JobActivityPanel"
import { JobDetailPlaceholderPanel } from "@/features/job-detail/JobDetailPlaceholderPanel"
import { JobSubtitlePanel } from "@/features/job-detail/JobSubtitlePanel"
import { useJobDetail } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"

function JobDetailTabs({
  job,
  tab,
  onTabChange,
}: {
  job: JobDetail
  tab: JobDetailTab
  onTabChange: (tab: JobDetailTab) => void
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as JobDetailTab)}
      className="app-dialog-tabs job-detail-tabs"
    >
      <TabsList variant="line" aria-label="詳情分頁">
        <TabsTrigger value="about">關於影音</TabsTrigger>
        <TabsTrigger value="activity">執行紀錄</TabsTrigger>
        <TabsTrigger value="source-subtitle">原始字幕</TabsTrigger>
        <TabsTrigger value="summary">影音摘要</TabsTrigger>
        <TabsTrigger value="translated-subtitle">翻譯字幕</TabsTrigger>
        <TabsTrigger value="segmentation">切分字幕</TabsTrigger>
        <TabsTrigger value="notes">影音筆記</TabsTrigger>
      </TabsList>
      <TabsContent value="about" className="detail-tab-panel job-about-panel">
        {tab === "about" ? <JobAboutPanel job={job} /> : null}
      </TabsContent>
      <TabsContent value="activity" className="detail-tab-panel">
        {tab === "activity" ? <JobActivityPanel job={job} /> : null}
      </TabsContent>
      <TabsContent
        value="source-subtitle"
        className="detail-tab-panel job-subtitle-panel"
      >
        {tab === "source-subtitle" ? (
          <JobSubtitlePanel job={job} view="source" />
        ) : null}
      </TabsContent>
      <TabsContent value="summary" className="detail-tab-panel">
        {tab === "summary" ? (
          <JobDetailPlaceholderPanel
            title="影音摘要尚未設定"
            description="這裡會顯示由 Agent 根據影音與字幕整理的摘要。"
          />
        ) : null}
      </TabsContent>
      <TabsContent
        value="translated-subtitle"
        className="detail-tab-panel job-subtitle-panel"
      >
        {tab === "translated-subtitle" ? (
          <JobSubtitlePanel job={job} view="translated" />
        ) : null}
      </TabsContent>
      <TabsContent value="segmentation" className="detail-tab-panel">
        {tab === "segmentation" ? (
          <JobDetailPlaceholderPanel
            title="切分字幕尚未設定"
            description="這裡會重用原始與翻譯字幕的時間軸，接著加入句子切分工具。"
          />
        ) : null}
      </TabsContent>
      <TabsContent value="notes" className="detail-tab-panel">
        {tab === "notes" ? (
          <JobDetailPlaceholderPanel
            title="影音筆記尚未設定"
            description="這裡會收納觀看影音時整理的筆記。"
          />
        ) : null}
      </TabsContent>
    </Tabs>
  )
}

export function JobDetailDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "detail" ? overlay.state : null
  const detail = useJobDetail(active?.videoId ?? null)
  const job = detail.data

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => (open ? undefined : overlay.actions.close("detail"))}
      kicker="JOB RECORD"
      title={job?.title ?? active?.videoId ?? "任務紀錄"}
      description="影音資訊、執行紀錄、字幕、摘要與筆記"
      size="screen"
      layout="tabbed"
    >
      {detail.isPending ? <LoadingState label="正在讀取任務紀錄" /> : null}
      {detail.isError ? <ErrorState message={detail.error.message} /> : null}
      {job ? (
        <JobDetailTabs
          job={job}
          tab={active?.tab ?? "about"}
          onTabChange={(tab) =>
            active &&
            overlay.actions.open({
              type: "detail",
              videoId: active.videoId,
              tab,
            })
          }
        />
      ) : null}
    </AppDialog>
  )
}
