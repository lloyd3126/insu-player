import {
  useOverlay,
  type JobDetailDestination,
  type JobDetailTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JobAboutPanel } from "@/features/job-detail/JobAboutPanel"
import { JobActivityPanel } from "@/features/job-detail/JobActivityPanel"
import { JobDetailPlaceholderPanel } from "@/features/job-detail/JobDetailPlaceholderPanel"
import { MediaQualityPanel } from "@/features/job-detail/MediaQualityPanel"
import { SubtitleManagementPanel } from "@/features/job-detail/SubtitleArtifactPanel"
import { useJobDetail } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"

function JobDetailTabs({
  job,
  destination,
  onDestinationChange,
}: {
  job: JobDetail
  destination: JobDetailDestination
  onDestinationChange: (destination: JobDetailDestination) => void
}) {
  const tab = destination.tab
  const openTab = (nextTab: JobDetailTab) => {
    onDestinationChange(
      nextTab === "subtitles"
        ? {
            type: "detail",
            videoId: job.videoId,
            tab: "subtitles",
            subtitleView: "source",
          }
        : {
            type: "detail",
            videoId: job.videoId,
            tab: nextTab,
          },
    )
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => openTab(value as JobDetailTab)}
      className="app-dialog-tabs job-detail-tabs"
    >
      <TabsList variant="line" aria-label="詳情分頁">
        <TabsTrigger value="about">關於影音</TabsTrigger>
        <TabsTrigger value="quality">畫質管理</TabsTrigger>
        <TabsTrigger value="subtitles">字幕管理</TabsTrigger>
        <TabsTrigger value="summary">影音摘要</TabsTrigger>
        <TabsTrigger value="notes">影音筆記</TabsTrigger>
        <TabsTrigger value="activity">執行紀錄</TabsTrigger>
      </TabsList>
      <TabsContent value="about" className="detail-tab-panel job-about-panel">
        {tab === "about" ? <JobAboutPanel job={job} /> : null}
      </TabsContent>
      <TabsContent
        value="quality"
        className="detail-tab-panel media-quality-panel"
      >
        {tab === "quality" ? <MediaQualityPanel job={job} /> : null}
      </TabsContent>
      <TabsContent
        value="subtitles"
        className="detail-tab-panel job-subtitle-panel"
      >
        {destination.tab === "subtitles" ? (
          <SubtitleManagementPanel
            job={job}
            view={destination.subtitleView}
            previewArtifactId={destination.artifactId}
            onViewChange={(subtitleView) =>
              onDestinationChange({
                type: "detail",
                videoId: job.videoId,
                tab: "subtitles",
                subtitleView,
              })
            }
            onPreviewArtifactChange={(artifactId) =>
              onDestinationChange({
                type: "detail",
                videoId: job.videoId,
                tab: "subtitles",
                subtitleView: destination.subtitleView,
                ...(artifactId ? { artifactId } : {}),
              })
            }
          />
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
      <TabsContent value="notes" className="detail-tab-panel">
        {tab === "notes" ? (
          <JobDetailPlaceholderPanel
            title="影音筆記尚未設定"
            description="這裡會收納觀看影音時整理的筆記。"
          />
        ) : null}
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
      description="影音資訊、執行紀錄、字幕、摘要與筆記"
      size="screen"
      layout="tabbed"
    >
      {detail.isPending ? <LoadingState label="正在讀取任務紀錄" /> : null}
      {detail.isError ? <ErrorState message={detail.error.message} /> : null}
      {job ? (
        <JobDetailTabs
          job={job}
          destination={active ?? {
            type: "detail",
            videoId: job.videoId,
            tab: "about",
          }}
          onDestinationChange={(destination) =>
            active && overlay.actions.open(destination)
          }
        />
      ) : null}
    </AppDialog>
  )
}
