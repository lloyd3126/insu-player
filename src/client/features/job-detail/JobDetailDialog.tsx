import { useOverlay, type JobDetailTab } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JobAboutPanel } from "@/features/job-detail/JobAboutPanel"
import { JobActivityPanel } from "@/features/job-detail/JobActivityPanel"
import { JobSegmentationPanel } from "@/features/job-detail/JobSegmentationPanel"
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
        <TabsTrigger value="about">關於</TabsTrigger>
        <TabsTrigger value="subtitle">字幕</TabsTrigger>
        <TabsTrigger value="segmentation">切分</TabsTrigger>
        <TabsTrigger value="activity">處理紀錄</TabsTrigger>
      </TabsList>
      <TabsContent value="about" className="detail-tab-panel job-about-panel">
        <JobAboutPanel job={job} />
      </TabsContent>
      <TabsContent value="subtitle" className="detail-tab-panel">
        {tab === "subtitle" ? <JobSubtitlePanel job={job} /> : null}
      </TabsContent>
      <TabsContent value="segmentation" className="detail-tab-panel">
        <JobSegmentationPanel />
      </TabsContent>
      <TabsContent value="activity" className="detail-tab-panel">
        {tab === "activity" ? <JobActivityPanel job={job} /> : null}
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
      description="影音資訊、字幕、切分與處理紀錄"
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
