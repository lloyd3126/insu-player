import {
  useOverlay,
  type IssueReportTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  IssueDiagnoseContent,
  IssueReviewContent,
  IssueSubmitContent,
} from "@/features/home/IssueReportGuideContent"

export function IssueReportDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "issue-report" ? overlay.state : null
  const selectTab = (tab: IssueReportTab) => {
    overlay.actions.open({ type: "issue-report", tab })
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("issue-report")
      }
      kicker="ISSUE REPORT"
      title="異常回報"
      description="請 Agent 唯讀偵查問題，檢查回報內容，再到 GitHub 建立 Issue"
      size="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs"
        value={active?.tab ?? "diagnose"}
        onValueChange={(value) => selectTab(value as IssueReportTab)}
      >
        <TabsList variant="line" aria-label="異常回報分頁">
          <TabsTrigger value="diagnose">1 偵查問題</TabsTrigger>
          <TabsTrigger value="review">2 檢查回報</TabsTrigger>
          <TabsTrigger value="submit">3 建立 Issue</TabsTrigger>
        </TabsList>
        <TabsContent value="diagnose" className="grouped-dialog-panel">
          {active?.tab === "diagnose" ? (
            <IssueDiagnoseContent onContinue={() => selectTab("review")} />
          ) : null}
        </TabsContent>
        <TabsContent value="review" className="grouped-dialog-panel">
          {active?.tab === "review" ? (
            <IssueReviewContent onContinue={() => selectTab("submit")} />
          ) : null}
        </TabsContent>
        <TabsContent value="submit" className="grouped-dialog-panel">
          {active?.tab === "submit" ? <IssueSubmitContent /> : null}
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
