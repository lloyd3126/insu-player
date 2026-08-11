import { describe, expect, test } from "bun:test"

import {
  detectProtocol,
  isOwnPlayerUrl,
  isSupportedMediaUrl,
  normalizeCandidates,
} from "./media-discovery.js"

describe("Chrome extension media discovery", () => {
  test("never offers the local INSU Player as a downloadable page", async () => {
    expect(isOwnPlayerUrl("http://127.0.0.1:8010/library")).toBe(true)
    expect(isOwnPlayerUrl("http://localhost:8000/settings")).toBe(true)
    expect(
      await normalizeCandidates([
        { kind: "page", pageUrl: "http://127.0.0.1:8010/library" },
      ]),
    ).toEqual([])
  })

  test("normalizes page, iframe, MP4, and HLS candidates without duplicates", async () => {
    const candidates = await normalizeCandidates([
      { kind: "page", pageUrl: "https://media.example/watch/one#comments" },
      {
        kind: "embed",
        pageUrl: "https://media.example/watch/one",
        frameUrl: "https://embed.example/player/one",
      },
      {
        kind: "network-media",
        pageUrl: "https://media.example/watch/one",
        frameUrl: "https://embed.example/player/one",
        mediaUrl: "https://cdn.example/one.mp4?token=short-lived",
      },
      {
        kind: "network-media",
        pageUrl: "https://media.example/watch/one",
        frameUrl: "https://embed.example/player/one",
        mediaUrl: "https://cdn.example/master.m3u8?token=short-lived",
        contentType: "application/vnd.apple.mpegurl",
      },
      {
        kind: "network-media",
        pageUrl: "https://media.example/watch/one",
        frameUrl: "https://embed.example/player/one",
        mediaUrl: "https://cdn.example/master.m3u8?token=short-lived",
        contentType: "application/vnd.apple.mpegurl",
      },
    ])

    expect(candidates).toHaveLength(4)
    expect(candidates.map(({ kind }) => kind)).toEqual([
      "page",
      "embed",
      "network-media",
      "network-media",
    ])
    expect(candidates[2].protocol).toBe("https")
    expect(candidates[3].protocol).toBe("hls")
    expect(candidates.every(({ candidateFingerprint }) =>
      /^[0-9a-f]{64}$/.test(candidateFingerprint),
    )).toBe(true)
  })

  test("accepts supported response content types but rejects unrelated URLs", () => {
    expect(
      isSupportedMediaUrl(
        "https://cdn.example/opaque?id=1",
        "application/x-mpegURL",
      ),
    ).toBe(true)
    expect(isSupportedMediaUrl("https://cdn.example/page", "text/html")).toBe(
      false,
    )
    expect(detectProtocol("https://cdn.example/video.webm")).toBe("https")
  })
})
