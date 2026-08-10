import type {
  JobDetailTab,
  OverlayDestination,
  OverlayState,
  SubtitleManagementView,
} from "@/app/overlay-context"

const USAGE_GUIDE_TABS = new Set([
  "getting-started",
  "my-prompts",
  "supported-sites",
])
const FEATURE_SETTINGS_TABS = new Set([
  "environment",
  "local-models",
  "cloud-models",
])
const LIBRARY_VIEWS = new Set(["grid", "list"])
const JOB_DETAIL_TABS = new Set([
  "about",
  "quality",
  "subtitles",
  "summary",
  "notes",
  "activity",
])
const SUBTITLE_MANAGEMENT_VIEWS = new Set([
  "source",
  "proofread",
  "translation",
  "segmentation",
])
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function segmentsFrom(pathname: string) {
  return pathname.split("/").filter(Boolean).map(decodeSegment)
}

function setValue<T extends string>(values: Set<string>, value: string | undefined) {
  return value && values.has(value) ? (value as T) : null
}

function jobDetailTab(value: string | undefined) {
  return setValue<JobDetailTab>(JOB_DETAIL_TABS, value)
}

function subtitleManagementView(value: string | undefined) {
  return setValue<SubtitleManagementView>(SUBTITLE_MANAGEMENT_VIEWS, value)
}

function artifactIdFromSearch(search: string) {
  const value = new URLSearchParams(search).get("artifact")?.trim()
  return value && ARTIFACT_ID_PATTERN.test(value) ? value : undefined
}

function overlayDestinationFromLocation(
  pathname: string,
  search = "",
): OverlayDestination | null {
  const segments = segmentsFrom(pathname)
  if (segments.length === 0 || pathname === "/index.html") return null

  if (segments[0] === "guide" && segments.length <= 2) {
    return {
      type: "usage-guide",
      tab:
        setValue(USAGE_GUIDE_TABS, segments[1]) ?? "getting-started",
    }
  }
  if (segments[0] === "settings" && segments.length <= 2) {
    return {
      type: "feature-settings",
      tab:
        setValue(FEATURE_SETTINGS_TABS, segments[1]) ?? "environment",
    }
  }
  if (segments[0] === "library" && segments.length <= 2) {
    return {
      type: "library",
      view: setValue(LIBRARY_VIEWS, segments[1]),
    }
  }
  if (segments[0] === "jobs" && segments[1] && segments.length <= 4) {
    const tab = segments.length === 2 ? "about" : jobDetailTab(segments[2])
    if (!tab) return null
    if (tab === "subtitles") {
      const subtitleView =
        segments.length === 3
          ? "source"
          : subtitleManagementView(segments[3])
      if (!subtitleView) return null
      const artifactId = artifactIdFromSearch(search)
      return {
        type: "detail",
        videoId: segments[1],
        tab,
        subtitleView,
        ...(artifactId ? { artifactId } : {}),
      }
    }
    if (segments.length > 3) return null
    return {
      type: "detail",
      videoId: segments[1],
      tab,
    }
  }
  if (segments[0] === "player" && segments[1] && segments.length === 2) {
    const caption = new URLSearchParams(search).get("caption")?.trim()
    return {
      type: "player",
      videoId: segments[1],
      caption: caption || undefined,
    }
  }
  if (segments[0] === "policy" && segments.length === 1) {
    return {
      type: "policy",
      required: new URLSearchParams(search).get("required") === "1",
    }
  }
  return null
}

function returnToFromSearch(search: string) {
  const value = new URLSearchParams(search).get("returnTo")
  if (!value || value.length > 2_048 || !value.startsWith("/")) return undefined
  try {
    const origin = "http://insu-player.local"
    const candidate = new URL(value, origin)
    if (candidate.origin !== origin || candidate.hash) return undefined
    if (
      candidate.pathname !== "/" &&
      !overlayDestinationFromLocation(candidate.pathname, candidate.search)
    ) {
      return undefined
    }
    return `${candidate.pathname}${candidate.search}`
  } catch {
    return undefined
  }
}

export function overlayFromLocation(
  pathname: string,
  search = "",
): OverlayState {
  const destination = overlayDestinationFromLocation(pathname, search)
  if (!destination) return null
  const returnTo = returnToFromSearch(search)
  return returnTo ? { ...destination, returnTo } : destination
}

export function pathForOverlay(overlay: Exclude<OverlayState, null>) {
  const search = new URLSearchParams()
  let path: string
  switch (overlay.type) {
    case "usage-guide":
      path = `/guide/${overlay.tab}`
      break
    case "feature-settings":
      path = `/settings/${overlay.tab}`
      break
    case "library":
      path = overlay.view ? `/library/${overlay.view}` : "/library"
      break
    case "detail":
      path =
        overlay.tab === "subtitles"
          ? `/jobs/${encodeURIComponent(overlay.videoId)}/subtitles/${overlay.subtitleView}`
          : `/jobs/${encodeURIComponent(overlay.videoId)}/${overlay.tab}`
      if (overlay.tab === "subtitles" && overlay.artifactId) {
        search.set("artifact", overlay.artifactId)
      }
      break
    case "player":
      path = `/player/${encodeURIComponent(overlay.videoId)}`
      if (overlay.caption) search.set("caption", overlay.caption)
      break
    case "policy":
      path = "/policy"
      if (overlay.required) search.set("required", "1")
      break
  }
  if (overlay.returnTo) search.set("returnTo", overlay.returnTo)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
