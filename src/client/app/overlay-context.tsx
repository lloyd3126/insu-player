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
  | "activity"
  | "source-subtitle"
  | "summary"
  | "notes"
  | "translated-subtitle"
  | "segmentation"

export type OverlayDestination =
  | { type: "usage-guide"; tab: UsageGuideTab }
  | { type: "feature-settings"; tab: FeatureSettingsTab }
  | { type: "library"; view: LibraryView | null }
  | { type: "player"; videoId: string; caption?: string }
  | { type: "detail"; videoId: string; tab: JobDetailTab }
  | { type: "policy"; required: boolean }

export type OverlayState =
  | (OverlayDestination & { returnTo?: string })
  | null

type OverlayType = NonNullable<OverlayState>["type"]

interface OverlayActions {
  open: (
    overlay: Exclude<OverlayState, null>,
    options?: { replace?: boolean; returnTo?: string | null },
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
  const locationRef = useRef({
    pathname: location.pathname,
    search: location.search,
  })
  useEffect(() => {
    stateRef.current = state
    locationRef.current = {
      pathname: location.pathname,
      search: location.search,
    }
  }, [location.pathname, location.search, state])
  const open = useCallback<OverlayActions["open"]>(
    (overlay, options) => {
      const current = stateRef.current
      const sameOverlayType = current?.type === overlay.type
      const hasExplicitReturn = Boolean(
        options && Object.prototype.hasOwnProperty.call(options, "returnTo"),
      )
      const currentLocation = locationRef.current
      const currentPath = `${currentLocation.pathname}${currentLocation.search}`
      const returnTo = hasExplicitReturn
        ? options?.returnTo ?? undefined
        : overlay.returnTo ??
          (sameOverlayType
            ? current?.returnTo
            : current
              ? currentPath
              : undefined)
      navigate(pathForOverlay({ ...overlay, returnTo }), {
        replace: options?.replace ?? sameOverlayType,
      })
    },
    [navigate],
  )
  const close = useCallback<OverlayActions["close"]>(
    (expectedType) => {
      const current = stateRef.current
      if (expectedType && current?.type !== expectedType) return
      const currentLocation = locationRef.current
      const currentPath = `${currentLocation.pathname}${currentLocation.search}`
      const fallback =
        current?.type === "player" || current?.type === "detail"
          ? "/library"
          : "/"
      const destination =
        current?.returnTo && current.returnTo !== currentPath
          ? current.returnTo
          : fallback
      navigate(destination, { replace: true })
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
