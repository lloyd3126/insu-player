import { createContext, use, useMemo, useState } from "react"

export type UsageGuideTab =
  | "getting-started"
  | "my-prompts"
  | "supported-sites"
export type FeatureSettingsTab =
  | "environment"
  | "local-models"
  | "cloud-models"

export type OverlayState =
  | { type: "usage-guide"; tab: UsageGuideTab }
  | { type: "feature-settings"; tab: FeatureSettingsTab }
  | { type: "library" }
  | { type: "player"; videoId: string; caption?: string }
  | { type: "detail"; videoId: string }
  | { type: "policy"; required: boolean }
  | null

type OverlayType = NonNullable<OverlayState>["type"]

interface OverlayContextValue {
  state: OverlayState
  actions: {
    open: (overlay: Exclude<OverlayState, null>) => void
    close: (expectedType?: OverlayType) => void
  }
  meta: {
    isOpen: boolean
  }
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OverlayState>(null)
  const value = useMemo<OverlayContextValue>(
    () => ({
      state,
      actions: {
        open: setState,
        close: (expectedType) =>
          setState((current) =>
            expectedType && current?.type !== expectedType ? current : null,
          ),
      },
      meta: { isOpen: state !== null },
    }),
    [state],
  )
  return <OverlayContext value={value}>{children}</OverlayContext>
}

export function useOverlay() {
  const context = use(OverlayContext)
  if (!context) throw new Error("useOverlay must be used within OverlayProvider")
  return context
}
