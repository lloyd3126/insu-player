import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  Clock3Icon,
  DownloadIcon,
  Link2Icon,
  PanelsTopLeftIcon,
  UnplugIcon,
} from "lucide-react"

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
    refetchInterval: (query) => (query.state.data?.paired ? 15_000 : 2_000),
  })
}

function saveDownload(download: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(download.blob)
  const anchor = document.createElement("a")
  try {
    anchor.href = url
    anchor.download = download.filename
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}

export function ChromeExtensionDownloadContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const packageDownload = useMutation({
    mutationFn: api.downloadExtensionPackage,
    onSuccess: saveDownload,
  })

  return (
    <div className="guide-tab-content">
      <TutorialCard
        kicker="01 / DOWNLOAD"
        title="下載已設定的 Chrome 擴充功能"
        description="這份 ZIP 已包含連接目前 INSU Player 所需的一次性設定。安裝後會自動連接，不需要另外下載或上傳設定檔。"
        footer={(
          <Button onClick={onContinue}>
            前往安裝與連接
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="下載目前服務產生的 ZIP"
            description="ZIP 只會連接目前 workspace 與 localhost，不包含 API Key、Cookie 或影音資料。"
          />
          <TutorialStep
            number="02"
            title="在 30 分鐘內完成安裝"
            description="一次性連接設定逾期或已使用時，回到這裡重新下載新的 ZIP。"
          />
        </TutorialStepList>
        <div className="extension-download-actions">
          <Button
            variant="outline"
            disabled={packageDownload.isPending}
            onClick={() => packageDownload.mutate()}
          >
            <DownloadIcon data-icon="inline-start" />
            {packageDownload.isPending ? "正在建立專屬 ZIP" : "下載 Chrome 擴充功能"}
          </Button>
        </div>
        {packageDownload.error ? (
          <p className="extension-guide-error">{packageDownload.error.message}</p>
        ) : null}
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
  const port = status?.serverOrigin ? new URL(status.serverOrigin).port : null

  return (
    <div className="guide-tab-content">
      <TutorialCard
        kicker={status?.paired ? "02 / READY" : "02 / CONNECT"}
        title={status?.paired ? "Chrome 已連接" : "安裝後自動連接"}
        description={
          status?.paired
            ? `擴充功能已連接目前的本機服務${port ? `，連接埠為 ${port}` : ""}。`
            : "以開發人員模式載入解壓縮後的資料夾，再開啟擴充功能，它會自動連接目前的 INSU Player。"
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
              <strong>{status?.paired ? "Chrome 已連接" : "等待擴充功能連接"}</strong>
              <small>
                {status?.paired
                  ? `最近確認 ${status.lastSeenAt ? new Date(status.lastSeenAt).toLocaleString() : "尚未回報"}`
                  : "載入擴充功能後，此畫面會自動更新。"}
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
              title="解壓縮 ZIP"
              description="保留解壓縮後的資料夾，Chrome 會持續從這個位置讀取擴充功能。"
            />
            <TutorialStep
              number="02"
              title="在 Chrome 載入未封裝項目"
              description="開啟 chrome://extensions/，啟用開發人員模式並選擇解壓縮後的資料夾。"
            />
            <TutorialStep
              number="03"
              title="開啟 INSU Player 擴充功能"
              description="擴充功能會讀取 ZIP 內的一次性設定並自動連接，不需要選擇任何檔案。"
            />
          </TutorialStepList>
        ) : null}
        {!status?.paired ? (
          <div className="extension-capability-note">
            <Clock3Icon aria-hidden="true" />
            <p>ZIP 逾期、已使用或來自其他版本時，回到「下載」重新取得即可。</p>
          </div>
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
            : "目前尚未連接。你可以先閱讀操作方式，再回到安裝與連接完成設定。"
        }
        footer={!pairing.isPending && !paired ? (
          <Button onClick={onReconnect}>
            回到安裝與連接
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : undefined}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="停在要加入的影音頁"
            description="點擊 Chrome 工具列中的 INSU Player。"
          />
          <TutorialStep
            number="02"
            title="自動整理下載來源"
            description="一般頁面、iframe、MP4 與已結束的 M3U8 會依序交給 yt-dlp 作為同一支影音的備援來源。"
          />
          <TutorialStep
            number="03"
            title="沿用目前登入狀態"
            description="加入時會自動帶入這組來源需要的 Cookie，只供這一次本機下載使用，完成就刪除。"
          />
          <TutorialStep
            number="04"
            title="在 Chrome 影片頁觀看"
            description="開啟擴充功能右上角按鈕，查看卡片、播放器與字幕。"
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
