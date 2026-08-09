import { EmptyState } from "@/components/shared/AsyncState"
import { Separator } from "@/components/ui/separator"

export function JobSegmentationPanel() {
  return (
    <>
      <EmptyState
        title="切分檢視尚未設定"
        description="這裡會重用字幕時間軸與多語對照元件，接著加入句子切分工具。"
      />
      <Separator />
    </>
  )
}
