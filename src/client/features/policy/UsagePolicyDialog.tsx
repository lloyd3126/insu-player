import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { Button } from "@/components/ui/button"
import { POLICY_KEY } from "@/features/policy/constants"

const RULES = [
  ["01", "合法來源", "只處理你有權下載、轉錄與觀看的媒體。"],
  ["02", "不繞過限制", "不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。"],
  ["03", "本機資料", "影音、字幕與播放狀態保存在目前選定的 workspace。"],
  ["04", "服務與免責", "服務依「現狀」與「可用狀態」提供，來源網站變更可能影響處理結果。"],
]

export function UsagePolicyDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "policy" ? overlay.state : null
  const finish = () => {
    if (active?.required) localStorage.setItem(POLICY_KEY, "accepted")
    overlay.actions.close("policy")
  }
  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => {
        if (!open && !active?.required) overlay.actions.close("policy")
      }}
      kicker="USER AGREEMENT"
      title="使用規範"
      description="INSU Player 媒體處理規範"
      size="default"
    >
      <p className="policy-lead">
        使用 INSU Player 前，請確認你有權處理交付的影音與字幕。
      </p>
      <ol className="policy-list">
        {RULES.map(([number, title, description]) => (
          <li key={number}>
            <span>{number}</span>
            <div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="policy-actions">
        <Button onClick={finish}>
          {active?.required ? "我了解並同意" : "關閉規範"}
        </Button>
      </div>
    </AppDialog>
  )
}
