import {
  useOverlay,
  type UsageGuideTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MyPromptsContent } from "@/features/home/MyPromptsContent"
import { UsageContent } from "@/features/home/UsageDialog"
import { SupportedSitesContent } from "@/features/resources/SupportedSitesDialog"

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
      title="使用說明"
      description="開始使用、我的提示與支援網站"
      size="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs"
        value={active?.tab ?? "getting-started"}
        onValueChange={(value) => selectTab(value as UsageGuideTab)}
      >
        <TabsList variant="line" aria-label="使用說明分頁">
          <TabsTrigger value="getting-started">開始使用</TabsTrigger>
          <TabsTrigger value="my-prompts">我的提示</TabsTrigger>
          <TabsTrigger value="supported-sites">支援網站</TabsTrigger>
        </TabsList>
        <TabsContent value="getting-started" className="grouped-dialog-panel">
          {active?.tab === "getting-started" ? <UsageContent /> : null}
        </TabsContent>
        <TabsContent
          value="my-prompts"
          className="grouped-dialog-panel my-prompts-panel"
        >
          {active?.tab === "my-prompts" ? <MyPromptsContent /> : null}
        </TabsContent>
        <TabsContent
          value="supported-sites"
          className="grouped-dialog-panel supported-sites-panel"
        >
          {active?.tab === "supported-sites" ? (
            <SupportedSitesContent />
          ) : null}
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
