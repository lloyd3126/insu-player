import type {
  AddMediaTab,
  ChromeExtensionTab,
  JobDetailTab,
  OverlayDestination,
  OverlayState,
  SubtitleManagementView,
} from "@/app/overlay-context"

const USAGE_GUIDE_TABS = new Set([
  "initialize",
  "add-media",
  "handoff",
])
const CHROME_EXTENSION_TABS = new Set(["install", "connect", "usage"])
const ADD_MEDIA_TABS = new Set(["sources", "downloads", "handoff"])
const LIBRARY_VIEWS = new Set(["grid", "list"])
const LIBRARY_STATUSES = new Set(["all", "active", "attention", "watchable", "ready"])
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
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,159}$/
const DOWNLOAD_BATCH_ID_PATTERN = /^batch-\d{13}-[0-9a-f]{8}$/

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
    const tab = segments.length === 1
      ? "initialize"
      : setValue<"initialize" | "add-media" | "handoff">(
          USAGE_GUIDE_TABS,
          segments[1],
        )
    return tab ? { type: "usage-guide", tab } : null
  }
  if (segments[0] === "prompts" && segments.length === 1) {
    return { type: "my-prompts" }
  }
  if (segments[0] === "supported-sites" && segments.length === 1) {
    return { type: "supported-sites" }
  }
  if (segments[0] === "extension" && segments.length <= 2) {
    const tab =
      setValue<ChromeExtensionTab>(CHROME_EXTENSION_TABS, segments[1]) ??
      (segments.length === 1 ? "install" : null)
    return tab ? { type: "chrome-extension", tab } : null
  }
  if (segments[0] === "settings") {
    if (segments.length === 1) return { type: "transcription-settings" }
    if (
      segments.length === 3 &&
      segments[1] === "models" &&
      MODEL_ID_PATTERN.test(segments[2])
    ) {
      return { type: "transcription-settings", modelId: segments[2] }
    }
    return null
  }
  if (segments[0] === "library" && segments[1] === "add" && segments.length === 3) {
    const tab = setValue<AddMediaTab>(ADD_MEDIA_TABS, segments[2])
    if (!tab) return null
    const batchId = new URLSearchParams(search).get("batch")?.trim()
    return {
      type: "add-media",
      tab,
      ...(batchId && DOWNLOAD_BATCH_ID_PATTERN.test(batchId) ? { batchId } : {}),
    }
  }
  if (segments[0] === "library" && segments[1] === "add") return null
  if (segments[0] === "library" && segments.length <= 2) {
    const params = new URLSearchParams(search)
    const query = params.get("q")?.trim().slice(0, 200)
    const status = setValue<"all" | "active" | "attention" | "watchable" | "ready">(
      LIBRARY_STATUSES,
      params.get("status") ?? undefined,
    )
    return {
      type: "library",
      view: setValue(LIBRARY_VIEWS, segments[1]),
      ...(query ? { query } : {}),
      ...(status && status !== "all" ? { status } : {}),
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
    const params = new URLSearchParams(search)
    const caption = params.get("caption")?.trim()
    const rawTime = params.get("time")
    const parsedTime = rawTime === null ? Number.NaN : Number(rawTime)
    const time =
      Number.isFinite(parsedTime) && parsedTime >= 0 && parsedTime <= 604_800
        ? Math.round(parsedTime * 1000) / 1000
        : undefined
    return {
      type: "player",
      videoId: segments[1],
      caption: caption || undefined,
      ...(time === undefined ? {} : { time }),
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
    case "my-prompts":
      path = "/prompts"
      break
    case "supported-sites":
      path = "/supported-sites"
      break
    case "chrome-extension":
      path = `/extension/${overlay.tab}`
      break
    case "transcription-settings":
      path = overlay.modelId
        ? `/settings/models/${encodeURIComponent(overlay.modelId)}`
        : "/settings"
      break
    case "library":
      path = overlay.view ? `/library/${overlay.view}` : "/library"
      if (overlay.query) search.set("q", overlay.query)
      if (overlay.status && overlay.status !== "all") {
        search.set("status", overlay.status)
      }
      break
    case "add-media":
      path = `/library/add/${overlay.tab}`
      if (overlay.batchId) search.set("batch", overlay.batchId)
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
      if (overlay.time !== undefined) search.set("time", String(overlay.time))
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
