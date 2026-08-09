import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRightIcon,
  LibraryBigIcon,
} from "lucide-react"
import { useEffect } from "react"

import birdImage from "@library-assets/taiwan-whistling-thrush.png"

import { OverlayCoordinator } from "@/app/OverlayCoordinator"
import { useOverlay, type OverlayState } from "@/app/overlay-context"
import { Button } from "@/components/ui/button"
import { POLICY_KEY } from "@/features/policy/constants"
import { useJobsQuery } from "@/hooks/use-jobs-query"

const NAV_ITEMS: Array<{
  label: string
  state: Exclude<OverlayState, null>
}> = [
  {
    label: "使用說明",
    state: { type: "usage-guide", tab: "getting-started" },
  },
  {
    label: "功能設定",
    state: { type: "feature-settings", tab: "environment" },
  },
]

function LocalServiceStatus() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health", { cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<{ ok: boolean; port?: number }>
    },
    refetchInterval: 15_000,
  })
  return (
    <span className="server-state" role="status">
      <span
        className="server-lamp"
        data-online={health.data?.ok ? "true" : "false"}
        aria-hidden="true"
      />
      <span>
        {health.data?.ok
          ? `本機服務已連線${health.data.port ? ` · ${health.data.port}` : ""}`
          : health.isError
            ? "本機服務連線異常"
            : "正在連接本機服務"}
      </span>
    </span>
  )
}

export function App() {
  const overlay = useOverlay()
  const jobs = useJobsQuery()

  useEffect(() => {
    try {
      if (localStorage.getItem(POLICY_KEY) !== "accepted") {
        overlay.actions.open({ type: "policy", required: true })
      }
    } catch {
      overlay.actions.open({ type: "policy", required: true })
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="回到 INSU Player 首頁">
          <img src={birdImage} alt="" />
          <strong>INSU PLAYER</strong>
        </a>
        <nav className="primary-nav" aria-label="主要導覽">
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.label}
              variant="ghost"
              onClick={() => overlay.actions.open(item.state)}
            >
              {item.label}
            </Button>
          ))}
          <Button
            className="nav-library"
            variant="outline"
            onClick={() =>
              overlay.actions.open({ type: "library", view: null })
            }
          >
            <LibraryBigIcon data-icon="inline-start" />
            影音中心
            <strong>{jobs.data?.jobs.length ?? "—"}</strong>
          </Button>
        </nav>
      </header>

      <main className="landing">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-message">
            <p className="eyebrow">交付影音 / 準備字幕 / 開始播放</p>
            <h1 id="page-title">
              用 Agent
              <br />
              <span>讓影音跨越語言</span>
            </h1>
            <p className="hero-copy">
              把想看的影音網址交給 Agent，Agent 會準備好影音與字幕後，放進
              INSU 讓你觀看。
            </p>
            <Button
              className="hero-direction"
              size="lg"
              onClick={() =>
                overlay.actions.open({
                  type: "usage-guide",
                  tab: "getting-started",
                })
              }
            >
              開始使用
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </div>
          <div className="hero-artwork">
            <img src={birdImage} alt="臺灣紫嘯鶇品牌標誌" />
          </div>
        </section>

        <footer className="landing-footer">
          <LocalServiceStatus />
          <span className="footer-middle">
            <span>© {new Date().getFullYear()} INSU</span>
            <Button
              variant="link"
              onClick={() =>
                overlay.actions.open({ type: "policy", required: false })
              }
            >
              使用規範
            </Button>
          </span>
        </footer>
      </main>
      <OverlayCoordinator />
    </div>
  )
}
