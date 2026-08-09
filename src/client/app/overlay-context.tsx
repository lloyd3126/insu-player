import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react"
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

interface OverlayActions {
  open: (
    overlay: Exclude<OverlayState, null>,
    options?: { replace?: boolean },
  ) => void
  close: (expectedType?: OverlayType) => void
}

interface OverlayContextValue {
  state: OverlayState
  actions: OverlayActions
  meta: {
    isOpen: boolean
  }
}

const OverlayStateContext = createContext<OverlayState | undefined>(undefined)
const OverlayActionsContext = createContext<OverlayActions | undefined>(undefined)

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const state = useMemo(
    () => overlayFromLocation(location.pathname, location.search),
    [location.pathname, location.search],
  )
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const open = useCallback<OverlayActions["open"]>(
    (overlay, options) =>
      navigate(pathForOverlay(overlay), { replace: options?.replace }),
    [navigate],
  )
  const close = useCallback<OverlayActions["close"]>(
    (expectedType) => {
      if (expectedType && stateRef.current?.type !== expectedType) return
      navigate("/")
    },
    [navigate],
  )
  const actions = useMemo<OverlayActions>(
    () => ({
      open,
      close,
    }),
    [close, open],
  )
  return (
    <OverlayActionsContext value={actions}>
      <OverlayStateContext value={state}>{children}</OverlayStateContext>
    </OverlayActionsContext>
  )
}

export function useOverlayState() {
  const state = use(OverlayStateContext)
  if (state === undefined) {
    throw new Error("useOverlayState must be used within OverlayProvider")
  }
  return state
}

export function useOverlayActions() {
  const actions = use(OverlayActionsContext)
  if (!actions) {
    throw new Error("useOverlayActions must be used within OverlayProvider")
  }
  return actions
}

export function useOverlay() {
  const state = useOverlayState()
  const actions = useOverlayActions()
  return useMemo<OverlayContextValue>(
    () => ({ state, actions, meta: { isOpen: state !== null } }),
    [actions, state],
  )
}
