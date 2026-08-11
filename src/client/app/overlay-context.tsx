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
import type { SubtitleArtifactKind } from "@shared/contracts/subtitle-catalog"

export type UsageGuideTab =
  | "initialize"
  | "add-media"
  | "handoff"
export type ChromeExtensionTab = "install" | "connect" | "usage"
export type LibraryView = "grid" | "list"
export type JobDetailTab =
  | "about"
  | "quality"
  | "subtitles"
  | "summary"
  | "notes"
  | "activity"
export type SubtitleManagementView = SubtitleArtifactKind

type StandardJobDetailTab = Exclude<JobDetailTab, "subtitles">

export type JobDetailDestination =
  | { type: "detail"; videoId: string; tab: StandardJobDetailTab }
  | {
      type: "detail"
      videoId: string
      tab: "subtitles"
      subtitleView: SubtitleManagementView
      artifactId?: string
    }

export type OverlayDestination =
  | { type: "usage-guide"; tab: UsageGuideTab }
  | { type: "my-prompts" }
  | { type: "supported-sites" }
  | { type: "chrome-extension"; tab: ChromeExtensionTab }
  | { type: "transcription-settings"; modelId?: string }
  | {
      type: "library"
      view: LibraryView | null
      query?: string
      status?: "all" | "active" | "attention" | "watchable" | "ready"
    }
  | { type: "add-media" }
  | { type: "player"; videoId: string; caption?: string; time?: number }
  | JobDetailDestination
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
        current?.type === "player" || current?.type === "detail" || current?.type === "add-media"
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
