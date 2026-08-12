import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRightIcon,
  LibraryBigIcon,
  ListPlusIcon,
} from "lucide-react"
import { memo, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"

import birdImage from "@library-assets/taiwan-whistling-thrush.png"

import { OverlayCoordinator } from "@/app/OverlayCoordinator"
import { useOverlayActions } from "@/app/overlay-context"
import { buttonVariants } from "@/components/ui/button"
import { POLICY_KEY } from "@/features/policy/constants"
import { useLibraryQuery } from "@/hooks/use-library-query"
import { BrowserLibraryPage } from "@/features/library/BrowserLibraryPage"

const NAV_ITEMS: Array<{
  label: string
  to: string
}> = [
  {
    label: "開始說明",
    to: "/guide/initialize",
  },
  {
    label: "我的提示",
    to: "/prompts",
  },
  {
    label: "轉錄設定",
    to: "/settings",
  },
  {
    label: "支援網站",
    to: "/supported-sites",
  },
  {
    label: "擴充功能",
    to: "/extension/download",
  },
]

function RequiredPolicyGate() {
  const { open } = useOverlayActions()

  useEffect(() => {
    try {
      if (localStorage.getItem(POLICY_KEY) !== "accepted") {
        open({ type: "policy", required: true })
      }
    } catch {
      open({ type: "policy", required: true })
    }
  }, [open])

  return null
}

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

const HomeShell = memo(function HomeShell() {
  const library = useLibraryQuery()

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="回到 INSU Player 首頁">
          <img src={birdImage} alt="" />
          <strong>INSU PLAYER</strong>
        </a>
        <nav className="primary-nav" aria-label="主要導覽">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              className={buttonVariants({ variant: "ghost" })}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
          <Link
            className={buttonVariants({ variant: "outline", className: "nav-library" })}
            to={library.data?.items.length ? "/library/grid" : "/library/list"}
          >
            <LibraryBigIcon data-icon="inline-start" />
            影片中心
            <strong>{library.data?.items.length ?? "—"}</strong>
          </Link>
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
            <div className="hero-actions">
              <Link
                className={buttonVariants({ size: "lg", className: "hero-direction" })}
                to="/guide/initialize"
              >
                開始說明
                <ArrowUpRightIcon data-icon="inline-end" />
              </Link>
              <Link
                className={buttonVariants({ variant: "outline", size: "lg" })}
                to="/library/list"
              >
                <ListPlusIcon data-icon="inline-start" />
                加入影音
              </Link>
            </div>
          </div>
          <div className="hero-artwork">
            <img src={birdImage} alt="臺灣紫嘯鶇品牌標誌" />
          </div>
        </section>

        <footer className="landing-footer">
          <LocalServiceStatus />
          <span className="footer-middle">
            <span>© {new Date().getFullYear()} INSU</span>
            <Link className={buttonVariants({ variant: "link" })} to="/policy">
              使用規範
            </Link>
          </span>
        </footer>
      </main>
    </div>
  )
})

function HomeApp() {
  return (
    <>
      <RequiredPolicyGate />
      <HomeShell />
      <OverlayCoordinator />
    </>
  )
}

export function App() {
  const location = useLocation()
  return location.pathname === "/extension/library" ? (
    <BrowserLibraryPage />
  ) : (
    <HomeApp />
  )
}
