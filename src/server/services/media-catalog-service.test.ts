import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  activeMediaPath,
  publicMediaCatalog,
  setActiveMediaRendition,
} from "@server/services/media-catalog-service"

let root = ""
let job = ""

function rendition(id: string, height: number, contents: string) {
  const relativePath = `source/renditions/${id}.mp4`
  writeFileSync(path.join(job, relativePath), contents)
  return {
    id,
    requestedHeight: height,
    width: Math.round((height * 16) / 9),
    height,
    container: "mp4",
    videoCodec: "avc1",
    audioCodec: "aac",
    formatId: `${height}-source-format`,
    selection: `media-work/runs/${id}/selection.json`,
    path: relativePath,
    sizeBytes: Buffer.byteLength(contents),
    checksum: createHash("sha256").update(contents).digest("hex"),
    createdAt: "2026-08-08T00:00:00.000Z",
  }
}

function writeCatalog(overrides: Record<string, unknown> = {}) {
  const payload = {
    schemaVersion: 1,
    videoId: "demo-video",
    revision: 4,
    activeRenditionId: "720p-test",
    availability: {
      discoveredAt: "2026-08-08T00:00:00.000Z",
      formats: [
        {
          height: 1080,
          width: 1920,
          fps: 30,
          estimatedBytes: null,
          container: "mp4",
          videoCodec: "avc1",
        },
      ],
    },
    renditions: [
      rendition("720p-test", 720, "720p media"),
      rendition("1080p-test", 1080, "1080p media"),
    ],
    operation: null,
    ...overrides,
  }
  writeFileSync(
    path.join(job, "media-work", "catalog.json"),
    `${JSON.stringify(payload)}\n`,
  )
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "insu-media-catalog-"))
  job = path.join(root, "demo-video")
  mkdirSync(path.join(job, "source", "renditions"), { recursive: true })
  mkdirSync(path.join(job, "media-work"), { recursive: true })
  writeCatalog()
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("media catalog service", () => {
  test("returns only public rendition metadata and resolves the active media", () => {
    const catalog = publicMediaCatalog(job, "demo-video")
    expect(catalog.activeRenditionId).toBe("720p-test")
    expect(catalog.renditions.map(({ height, active }) => [height, active])).toEqual([
      [720, true],
      [1080, false],
    ])
    expect(catalog.renditions[0]).not.toHaveProperty("path")
    expect(catalog.renditions[0]).not.toHaveProperty("formatId")
    expect(catalog.renditions[0]).not.toHaveProperty("selection")
    expect(activeMediaPath(job, "demo-video")).toBe(
      realpathSync(path.join(job, "source", "renditions", "720p-test.mp4")),
    )
  })

  test("activates an existing rendition with an atomic revision update", () => {
    const catalog = setActiveMediaRendition(job, "demo-video", "1080p-test")
    expect(catalog.revision).toBe(5)
    expect(catalog.activeRenditionId).toBe("1080p-test")
    expect(catalog.renditions.find(({ height }) => height === 1080)?.active).toBe(
      true,
    )
  })

  test("reports an orphaned active operation as interrupted without rewriting it", () => {
    writeCatalog({
      operation: {
        id: "quality-1080p-test",
        requestedHeight: 1080,
        state: "downloading",
        stage: "downloading",
        progress: 42,
        message: "正在下載",
        error: null,
        pid: 2_147_483_647,
        startedAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:01:00.000Z",
        completedAt: null,
      },
    })
    expect(publicMediaCatalog(job, "demo-video").operation).toMatchObject({
      state: "interrupted",
      pid: null,
    })
  })

  test("keeps a fresh operation active while its worker changes process", () => {
    const timestamp = new Date().toISOString()
    writeCatalog({
      operation: {
        id: "quality-1080p-fresh",
        requestedHeight: 1080,
        state: "validating",
        stage: "validating",
        progress: 100,
        message: "正在驗證",
        error: null,
        pid: 2_147_483_647,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      },
    })
    expect(publicMediaCatalog(job, "demo-video").operation).toMatchObject({
      state: "validating",
      pid: 2_147_483_647,
    })
  })

  test("rejects a catalog whose active rendition file is missing", () => {
    rmSync(path.join(job, "source", "renditions", "720p-test.mp4"))
    expect(() => publicMediaCatalog(job, "demo-video")).toThrow(
      "media rendition file is unavailable",
    )
  })

  test("rejects rendition fields omitted by an older catalog shape", () => {
    const oldRendition = rendition("720p-test", 720, "720p media") as Record<
      string,
      unknown
    >
    delete oldRendition.formatId
    writeCatalog({ renditions: [oldRendition] })
    expect(() => publicMediaCatalog(job, "demo-video")).toThrow(
      "media rendition fields are invalid",
    )
  })

  test("rejects source formats without the current codec field", () => {
    writeCatalog({
      availability: {
        discoveredAt: "2026-08-08T00:00:00.000Z",
        formats: [
          {
            height: 1080,
            width: 1920,
            fps: 30,
            estimatedBytes: null,
            container: "mp4",
          },
        ],
      },
    })
    expect(() => publicMediaCatalog(job, "demo-video")).toThrow(
      "media format is invalid",
    )
  })
})
