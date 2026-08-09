import { createContext, use, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { overlayFromLocation, pathForOverlay } from "@/app/overlay-routes"

export type UsageGuideTab =
  | "getting-started"
  | "my-prompts"
  | "supported-sites"
export type FeatureSettingsTab =
  | "environment"
  | "local-models"
  | "cloud-models"
export type LibraryView = "grid" | "list"
export type JobDetailTab =
  | "about"
  | "subtitle"
  | "segmentation"
  | "activity"

export type OverlayState =
  | { type: "usage-guide"; tab: UsageGuideTab }
  | { type: "feature-settings"; tab: FeatureSettingsTab }
  | { type: "library"; view: LibraryView | null }
  | { type: "player"; videoId: string; caption?: string }
  | { type: "detail"; videoId: string; tab: JobDetailTab }
  | { type: "policy"; required: boolean }
  | null

type OverlayType = NonNullable<OverlayState>["type"]

interface OverlayContextValue {
  state: OverlayState
  actions: {
    open: (
      overlay: Exclude<OverlayState, null>,
      options?: { replace?: boolean },
    ) => void
    close: (expectedType?: OverlayType) => void
  }
  meta: {
    isOpen: boolean
  }
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const state = useMemo(
    () => overlayFromLocation(location.pathname, location.search),
    [location.pathname, location.search],
  )
  const value = useMemo<OverlayContextValue>(
    () => ({
      state,
      actions: {
        open: (overlay, options) =>
          navigate(pathForOverlay(overlay), { replace: options?.replace }),
        close: (expectedType) => {
          if (expectedType && state?.type !== expectedType) return
          navigate("/")
        },
      },
      meta: { isOpen: state !== null },
    }),
    [navigate, state],
  )
  return <OverlayContext value={value}>{children}</OverlayContext>
}

export function useOverlay() {
  const context = use(OverlayContext)
  if (!context) throw new Error("useOverlay must be used within OverlayProvider")
  return context
}
