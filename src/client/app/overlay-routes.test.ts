import { describe, expect, test } from "bun:test"

import { overlayFromLocation, pathForOverlay } from "@/app/overlay-routes"

describe("overlay routes", () => {
  test("maps current standalone dialogs and tabbed dialogs to stable paths", () => {
    expect(overlayFromLocation("/guide/add-media")).toEqual({
      type: "usage-guide",
      tab: "add-media",
    })
    expect(overlayFromLocation("/guide/handoff")).toEqual({
      type: "usage-guide",
      tab: "handoff",
    })
    expect(pathForOverlay({
      type: "usage-guide",
      tab: "handoff",
    })).toBe("/guide/handoff")
    expect(overlayFromLocation("/guide/after-setup")).toBeNull()
    expect(overlayFromLocation("/guide/agent-flow")).toBeNull()
    expect(overlayFromLocation("/prompts")).toEqual({
      type: "my-prompts",
    })
    expect(pathForOverlay({ type: "my-prompts" })).toBe("/prompts")
    expect(overlayFromLocation("/supported-sites")).toEqual({
      type: "supported-sites",
    })
    expect(pathForOverlay({ type: "supported-sites" })).toBe("/supported-sites")
    expect(overlayFromLocation("/extension/connect")).toEqual({
      type: "chrome-extension",
      tab: "connect",
    })
    expect(overlayFromLocation("/extension")).toEqual({
      type: "chrome-extension",
      tab: "install",
    })
    expect(pathForOverlay({
      type: "chrome-extension",
      tab: "usage",
    })).toBe("/extension/usage")
    expect(overlayFromLocation("/extension/library")).toBeNull()
    expect(overlayFromLocation("/extension/unknown")).toBeNull()
    expect(overlayFromLocation("/library/add/downloads")).toEqual({
      type: "add-media",
      tab: "downloads",
    })
    expect(pathForOverlay({
      type: "add-media",
      tab: "handoff",
    })).toBe("/library/add/handoff")
    expect(
      overlayFromLocation(
        "/library/add/downloads",
        "?batch=batch-1770000000000-deadbeef",
      ),
    ).toEqual({
      type: "add-media",
      tab: "downloads",
      batchId: "batch-1770000000000-deadbeef",
    })
    expect(pathForOverlay({
      type: "add-media",
      tab: "handoff",
      batchId: "batch-1770000000000-deadbeef",
    })).toBe("/library/add/handoff?batch=batch-1770000000000-deadbeef")
    expect(
      overlayFromLocation("/library/add/downloads", "?batch=batch-demo"),
    ).toEqual({ type: "add-media", tab: "downloads" })
    expect(overlayFromLocation("/library/add")).toBeNull()
    expect(overlayFromLocation("/library/add/unknown")).toBeNull()
    expect(overlayFromLocation("/settings/models/cloud.groq.whisper-large-v3")).toEqual({
      type: "transcription-settings",
      modelId: "cloud.groq.whisper-large-v3",
    })
    expect(overlayFromLocation("/settings")).toEqual({
      type: "transcription-settings",
    })
    expect(pathForOverlay({
      type: "transcription-settings",
      modelId: "local.openai-whisper.medium",
    })).toBe(
      "/settings/models/local.openai-whisper.medium",
    )
    for (const legacy of [
      "/settings/transcription",
      "/settings/local-models",
      "/settings/cloud-models",
      "/settings/environment",
    ]) expect(overlayFromLocation(legacy)).toBeNull()
    expect(overlayFromLocation("/library/list")).toEqual({
      type: "library",
      view: "list",
    })
    expect(
      pathForOverlay({ type: "library", view: "grid" }),
    ).toBe("/library/grid")
  })

  test("preserves standard job detail tabs", () => {
    const overlay = overlayFromLocation("/jobs/video%20id/activity")
    expect(overlay).toEqual({
      type: "detail",
      videoId: "video id",
      tab: "activity",
    })
    expect(pathForOverlay(overlay!)).toBe("/jobs/video%20id/activity")

    const quality = overlayFromLocation("/jobs/video%20id/quality")
    expect(quality).toMatchObject({
      type: "detail",
      videoId: "video id",
      tab: "quality",
    })
    expect(pathForOverlay(quality!)).toBe("/jobs/video%20id/quality")
  })

  test("round trips nested subtitle views and the selected artifact", () => {
    expect(overlayFromLocation("/jobs/video%20id/subtitles")).toEqual({
      type: "detail",
      videoId: "video id",
      tab: "subtitles",
      subtitleView: "source",
    })

    const translation = overlayFromLocation(
      "/jobs/video%20id/subtitles/translation",
      "?artifact=translation-en-zh-TW-r2&returnTo=%2Flibrary%2Flist",
    )
    expect(translation).toEqual({
      type: "detail",
      videoId: "video id",
      tab: "subtitles",
      subtitleView: "translation",
      artifactId: "translation-en-zh-TW-r2",
      returnTo: "/library/list",
    })
    expect(pathForOverlay(translation!)).toBe(
      "/jobs/video%20id/subtitles/translation?artifact=translation-en-zh-TW-r2&returnTo=%2Flibrary%2Flist",
    )

    const segmentation = overlayFromLocation(
      "/jobs/video%20id/subtitles/segmentation",
    )
    expect(pathForOverlay(segmentation!)).toBe(
      "/jobs/video%20id/subtitles/segmentation",
    )
  })

  test("rejects legacy subtitle routes and invalid nested subtitle state", () => {
    expect(overlayFromLocation("/jobs/demo-video/source-subtitle")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/translated-subtitle")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/segmentation")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/subtitles/unknown")).toBeNull()
    expect(
      overlayFromLocation(
        "/jobs/demo-video/subtitles/source",
        "?artifact=%2Fnot-safe",
      ),
    ).toEqual({
      type: "detail",
      videoId: "demo-video",
      tab: "subtitles",
      subtitleView: "source",
    })
  })

  test("round trips player captions through the query string", () => {
    const overlay = overlayFromLocation("/player/demo-video", "?caption=zh-TW")
    expect(overlay).toEqual({
      type: "player",
      videoId: "demo-video",
      caption: "zh-TW",
    })
    expect(pathForOverlay(overlay!)).toBe(
      "/player/demo-video?caption=zh-TW",
    )
  })

  test("round trips safe modal return routes and rejects external or unknown routes", () => {
    const overlay = overlayFromLocation(
      "/player/demo-video",
      "?caption=zh-TW&returnTo=%2Flibrary%2Flist",
    )
    expect(overlay).toEqual({
      type: "player",
      videoId: "demo-video",
      caption: "zh-TW",
      returnTo: "/library/list",
    })
    expect(pathForOverlay(overlay!)).toBe(
      "/player/demo-video?caption=zh-TW&returnTo=%2Flibrary%2Flist",
    )
    expect(
      overlayFromLocation(
        "/player/demo-video",
        "?returnTo=https%3A%2F%2Fexample.com",
      ),
    ).toEqual({ type: "player", videoId: "demo-video" })
    expect(
      overlayFromLocation(
        "/player/demo-video",
        "?returnTo=%2Fapi%2Fhealth",
      ),
    ).toEqual({ type: "player", videoId: "demo-video" })
  })

  test("falls back to each modal's default tab", () => {
    expect(overlayFromLocation("/guide")).toMatchObject({
      type: "usage-guide",
      tab: "initialize",
    })
    expect(overlayFromLocation("/guide/getting-started")).toBeNull()
    expect(overlayFromLocation("/guide/unknown")).toBeNull()
    expect(overlayFromLocation("/guide/my-prompts")).toBeNull()
    expect(overlayFromLocation("/guide/supported-sites")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/unknown")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/subtitle")).toBeNull()
    expect(overlayFromLocation("/not-a-route")).toBeNull()
  })
})
