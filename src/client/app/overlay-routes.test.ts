import { describe, expect, test } from "bun:test"

import { overlayFromLocation, pathForOverlay } from "@/app/overlay-routes"

describe("overlay routes", () => {
  test("maps guide settings and library tabs to stable paths", () => {
    expect(overlayFromLocation("/guide/my-prompts")).toEqual({
      type: "usage-guide",
      tab: "my-prompts",
    })
    expect(overlayFromLocation("/settings/cloud-models")).toEqual({
      type: "feature-settings",
      tab: "cloud-models",
    })
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
    expect(overlayFromLocation("/guide/unknown")).toMatchObject({
      type: "usage-guide",
      tab: "getting-started",
    })
    expect(overlayFromLocation("/jobs/demo-video/unknown")).toBeNull()
    expect(overlayFromLocation("/jobs/demo-video/subtitle")).toBeNull()
    expect(overlayFromLocation("/not-a-route")).toBeNull()
  })
})
