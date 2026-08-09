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

  test("preserves the selected job detail tab", () => {
    const overlay = overlayFromLocation("/jobs/video%20id/activity")
    expect(overlay).toEqual({
      type: "detail",
      videoId: "video id",
      tab: "activity",
    })
    expect(pathForOverlay(overlay!)).toBe("/jobs/video%20id/activity")
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

  test("falls back to each modal's default tab", () => {
    expect(overlayFromLocation("/guide/unknown")).toMatchObject({
      type: "usage-guide",
      tab: "getting-started",
    })
    expect(overlayFromLocation("/jobs/demo-video/unknown")).toMatchObject({
      type: "detail",
      tab: "about",
    })
    expect(overlayFromLocation("/not-a-route")).toBeNull()
  })
})
