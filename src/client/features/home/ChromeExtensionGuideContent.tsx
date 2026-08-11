import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  Link2Icon,
  PanelsTopLeftIcon,
  UnplugIcon,
} from "lucide-react"
import { useState } from "react"

import { api } from "@/api/client"
import {
  TutorialCard,
  TutorialStep,
  TutorialStepList,
} from "@/components/shared/prompt-cards/TutorialCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const PAIRING_QUERY_KEY = ["extension-pairing"] as const

function useExtensionPairing() {
  return useQuery({
    queryKey: PAIRING_QUERY_KEY,
    queryFn: api.extensionPairing,
    refetchInterval: (query) => (query.state.data?.paired ? false : 2_000),
  })
}

export function ChromeExtensionInstallContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const pairing = useExtensionPairing()
  const [copied, setCopied] = useState(false)
  const copyDirectory = async () => {
    if (!pairing.data?.extensionDirectory) return
    await navigator.clipboard.writeText(pairing.data.extensionDirectory)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <div className="guide-tab-content">
      <TutorialCard
        kicker="01 / INSTALL"
        title="載入未封裝擴充功能"
        description="完成下列步驟後，前往連接目前的 INSU Player。"
        footer={(
          <Button
            disabled={!pairing.data?.extensionDirectory}
            onClick={onContinue}
          >
            我已載入，前往連接
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="開啟 Chrome 擴充功能"
            description="在網址列輸入 chrome://extensions/"
          />
          <TutorialStep
            number="02"
            title="開啟開發人員模式"
            description="再點擊載入未封裝項目"
          />
          <TutorialStep
            number="03"
            title="選擇 INSU Player 資料夾"
            description="使用下方顯示的實際擴充功能目錄"
          />
          <TutorialStep
            number="04"
            title="已載入過就按重新載入"
            description="Chrome 才會套用資料夾中最新的連接流程"
          />
        </TutorialStepList>
        <div className="extension-directory">
          <code>
            {pairing.data?.extensionDirectory ?? "正在讀取擴充功能路徑"}
          </code>
          <Button
            variant="outline"
            size="sm"
            disabled={!pairing.data?.extensionDirectory}
            onClick={copyDirectory}
          >
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <CopyIcon data-icon="inline-start" />
            )}
            {copied ? "已複製" : "複製路徑"}
          </Button>
        </div>
      </TutorialCard>
    </div>
  )
}

export function ChromeExtensionConnectContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const pairing = useExtensionPairing()
  const revokePairing = useMutation({
    mutationFn: api.revokeExtensionPairing,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PAIRING_QUERY_KEY }),
  })
  const status = pairing.data

  return (
    <div className="guide-tab-content">
      <TutorialCard
        kicker={status?.paired ? "02 / READY" : "02 / CONNECT"}
        title={status?.paired ? "Chrome 已連接" : "連接目前的本機服務"}
        description={
          status?.paired
            ? "連接已完成，接下來可以從 Chrome 分頁加入影音。"
            : "保持這個首頁開啟，再從 Chrome 工具列按一次連接。擴充功能會自動記住目前服務的實際連接埠。"
        }
        footer={status?.paired ? (
          <div className="extension-guide-actions">
            <Button
              variant="outline"
              disabled={revokePairing.isPending}
              onClick={() => revokePairing.mutate()}
            >
              <UnplugIcon data-icon="inline-start" />
              解除連接
            </Button>
            <Button onClick={onContinue}>
              前往使用
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        ) : undefined}
      >
        <div className="extension-pairing-status">
          <span>
            <PanelsTopLeftIcon aria-hidden="true" />
            <span>
              <strong>
                {status?.paired ? "Chrome 已連接" : "等待 Chrome 連接"}
              </strong>
              <small>
                {status?.paired
                  ? "擴充功能會自動沿用這個 workspace 的實際 localhost port"
                  : "連接只會在目前開啟的本機 INSU Player 分頁完成"}
              </small>
            </span>
          </span>
          <Badge variant={status?.paired ? "secondary" : "outline"}>
            {status?.paired ? "已連接" : "未連接"}
          </Badge>
        </div>
        {!status?.paired ? (
          <TutorialStepList>
            <TutorialStep
              number="01"
              title="保持 INSU Player 首頁開啟"
              description="目前這個分頁就是要連接的本機服務"
            />
            <TutorialStep
              number="02"
              title="點 Chrome 工具列中的 INSU Player"
              description="擴充功能會確認目前分頁是相同版本的 INSU Player"
            />
            <TutorialStep
              number="03"
              title="按下連接目前的 INSU Player"
              description="完成後這個畫面會自動更新為已連接"
            />
          </TutorialStepList>
        ) : null}
      </TutorialCard>
    </div>
  )
}

export function ChromeExtensionUsageContent({
  onReconnect,
}: {
  onReconnect: () => void
}) {
  const pairing = useExtensionPairing()
  const paired = pairing.data?.paired ?? false

  return (
    <div className="guide-tab-content">
      <TutorialCard
        kicker={paired ? "03 / READY" : "03 / USE"}
        title={paired ? "Chrome 擴充功能已可使用" : "從目前分頁加入影音"}
        description={
          paired
            ? "停在要加入的影音頁，再從 Chrome 工具列開啟 INSU Player。"
            : "目前尚未連接。你可以先閱讀操作方式，再回到連接完成設定。"
        }
        footer={!pairing.isPending && !paired ? (
          <Button onClick={onReconnect}>
            回到連接
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : undefined}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="停在要加入的影音頁"
            description="點擊 Chrome 工具列中的 INSU Player"
          />
          <TutorialStep
            number="02"
            title="選擇偵測到的來源"
            description="一般頁面、iframe、MP4 與已結束的 M3U8 都會進入同一個下載佇列"
          />
          <TutorialStep
            number="03"
            title="只在需要時帶入登入狀態"
            description="確認後 Cookie 只供這一次本機下載使用，完成就刪除"
          />
          <TutorialStep
            number="04"
            title="在 Chrome 影音頁觀看"
            description="開啟擴充功能右上角按鈕，查看卡片、播放器與字幕"
          />
        </TutorialStepList>
        <div className="extension-capability-note">
          <Link2Icon aria-hidden="true" />
          <p>
            擴充功能不會繞過 DRM、付費牆或帳號控制。直播與無法還原來源的
            blob 影音會明確停止，不會假裝已加入。
          </p>
        </div>
      </TutorialCard>
    </div>
  )
}
