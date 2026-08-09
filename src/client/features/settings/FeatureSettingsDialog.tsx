import {
  useOverlay,
  type FeatureSettingsTab,
} from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CloudModelsContent,
  LocalModelsContent,
} from "@/features/resources/ModelsDialog"
import { EnvironmentContent } from "@/features/settings/EnvironmentDialog"

export function FeatureSettingsDialog() {
  const overlay = useOverlay()
  const active =
    overlay.state?.type === "feature-settings" ? overlay.state : null
  const selectTab = (tab: FeatureSettingsTab) => {
    overlay.actions.open({ type: "feature-settings", tab })
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) =>
        open ? undefined : overlay.actions.close("feature-settings")
      }
      kicker="RUNTIME CONTROLS"
      title="功能設定"
      description="環境變數、本機模型與雲端模型"
      size="wide"
      height="screen"
      layout="tabbed"
    >
      <Tabs
        className="app-dialog-tabs grouped-dialog-tabs"
        value={active?.tab ?? "environment"}
        onValueChange={(value) => selectTab(value as FeatureSettingsTab)}
      >
        <TabsList variant="line" aria-label="功能設定分頁">
          <TabsTrigger value="environment">環境變數</TabsTrigger>
          <TabsTrigger value="local-models">本機模型</TabsTrigger>
          <TabsTrigger value="cloud-models">雲端模型</TabsTrigger>
        </TabsList>
        <TabsContent
          value="environment"
          className="grouped-dialog-panel settings-table-panel environment-settings-panel"
        >
          <EnvironmentContent />
        </TabsContent>
        <TabsContent
          value="local-models"
          className="grouped-dialog-panel settings-table-panel model-settings-panel"
        >
          <LocalModelsContent />
        </TabsContent>
        <TabsContent
          value="cloud-models"
          className="grouped-dialog-panel settings-table-panel model-settings-panel"
        >
          <CloudModelsContent
            onManageApiKey={() => selectTab("environment")}
          />
        </TabsContent>
      </Tabs>
    </AppDialog>
  )
}
