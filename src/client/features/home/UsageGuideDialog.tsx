import {
  useOverlay,
  type UsageGuideTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AgentHandoffContent,
  AddSingleMediaContent,
  InitializationContent,
} from "@/features/home/UsageDialog"

export function UsageGuideDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "usage-guide" ? overlay.state : null
  const selectTab = (tab: UsageGuideTab) => {
    overlay.actions.open({ type: "usage-guide", tab })
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("usage-guide")
      }
      kicker="INSU GUIDE"
      title="開始說明"
      description="依序完成初始化、加入影音，再把提示交給 Agent"
      size="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs"
        value={active?.tab ?? "initialize"}
        onValueChange={(value) => selectTab(value as UsageGuideTab)}
      >
        <TabsList variant="line" aria-label="開始說明分頁">
          <TabsTrigger value="initialize">1 初始化</TabsTrigger>
          <TabsTrigger value="add-media">2 加入影音</TabsTrigger>
          <TabsTrigger value="handoff">3 交給 Agent</TabsTrigger>
        </TabsList>
        <TabsContent value="initialize" className="grouped-dialog-panel">
          {active?.tab === "initialize" ? (
            <InitializationContent onContinue={() => selectTab("add-media")} />
          ) : null}
        </TabsContent>
        <TabsContent value="add-media" className="grouped-dialog-panel">
          {active?.tab === "add-media" ? (
            <AddSingleMediaContent onContinue={() => selectTab("handoff")} />
          ) : null}
        </TabsContent>
        <TabsContent value="handoff" className="grouped-dialog-panel">
          {active?.tab === "handoff" ? <AgentHandoffContent /> : null}
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
