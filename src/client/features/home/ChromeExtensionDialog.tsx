import {
  useOverlay,
  type ChromeExtensionTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChromeExtensionConnectContent,
  ChromeExtensionInstallContent,
  ChromeExtensionUsageContent,
} from "@/features/home/ChromeExtensionGuideContent"

export function ChromeExtensionDialog() {
  const overlay = useOverlay()
  const active =
    overlay.state?.type === "chrome-extension" ? overlay.state : null
  const selectTab = (tab: ChromeExtensionTab) => {
    overlay.actions.open({ type: "chrome-extension", tab })
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("chrome-extension")
      }
      kicker="CHROME EXTENSION"
      title="Chrome 擴充功能"
      description="安裝、連接並使用 INSU Player Chrome 擴充功能"
      size="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs"
        value={active?.tab ?? "install"}
        onValueChange={(value) => selectTab(value as ChromeExtensionTab)}
      >
        <TabsList variant="line" aria-label="Chrome 擴充功能分頁">
          <TabsTrigger value="install">1 安裝</TabsTrigger>
          <TabsTrigger value="connect">2 連接</TabsTrigger>
          <TabsTrigger value="usage">3 使用</TabsTrigger>
        </TabsList>
        <TabsContent value="install" className="grouped-dialog-panel">
          {active?.tab === "install" ? (
            <ChromeExtensionInstallContent
              onContinue={() => selectTab("connect")}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="connect" className="grouped-dialog-panel">
          {active?.tab === "connect" ? (
            <ChromeExtensionConnectContent
              onContinue={() => selectTab("usage")}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="usage" className="grouped-dialog-panel">
          {active?.tab === "usage" ? (
            <ChromeExtensionUsageContent
              onReconnect={() => selectTab("connect")}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
