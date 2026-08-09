import type { OverlayState } from "@/app/overlay-context"

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
  "subtitle",
  "segmentation",
  "activity",
])

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

export function overlayFromLocation(
  pathname: string,
  search = "",
): OverlayState {
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
  if (segments[0] === "jobs" && segments[1] && segments.length <= 3) {
    return {
      type: "detail",
      videoId: segments[1],
      tab: setValue(JOB_DETAIL_TABS, segments[2]) ?? "about",
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

export function pathForOverlay(overlay: Exclude<OverlayState, null>) {
  switch (overlay.type) {
    case "usage-guide":
      return `/guide/${overlay.tab}`
    case "feature-settings":
      return `/settings/${overlay.tab}`
    case "library":
      return overlay.view ? `/library/${overlay.view}` : "/library"
    case "detail":
      return `/jobs/${encodeURIComponent(overlay.videoId)}/${overlay.tab}`
    case "player": {
      const path = `/player/${encodeURIComponent(overlay.videoId)}`
      return overlay.caption
        ? `${path}?caption=${encodeURIComponent(overlay.caption)}`
        : path
    }
    case "policy":
      return overlay.required ? "/policy?required=1" : "/policy"
  }
}
