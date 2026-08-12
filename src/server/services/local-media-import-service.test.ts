import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { openAppDatabase } from "@server/db/client"
import { JobRepository } from "@server/repositories/job-repository"
import { LocalMediaImportService } from "@server/services/local-media-import-service"

const schema = path.resolve(
  "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql",
)
const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-player-import-"))
  workspaces.push(workspace)
  const ffmpeg = path.join(workspace, "fake-ffmpeg")
  writeFileSync(
    ffmpeg,
    "#!/bin/sh\nprintf 'Duration: 00:00:03.250, start: 0.000000, bitrate: 100 kb/s\\nStream #0:0: Video: h264, yuv420p, 640x360\\nStream #0:1: Audio: aac, 44100 Hz, stereo\\n' >&2\nexit 1\n",
    { mode: 0o700 },
  )
  chmodSync(ffmpeg, 0o700)
  const opened = openAppDatabase(path.join(workspace, "app.db"), schema)
  const jobs = new JobRepository(workspace, opened.db)
  return {
    workspace,
    opened,
    jobs,
    imports: new LocalMediaImportService(workspace, opened.db, jobs, ffmpeg),
  }
}

describe("local media import", () => {
  test("copies a selected local MP4 into one current-schema media item", async () => {
    const { workspace, opened, jobs, imports } = fixture()
    const bytes = new TextEncoder().encode("test-mp4")
    const created = imports.create({
      originalName: "My Clip.mp4",
      title: "My Clip",
      sizeBytes: bytes.byteLength,
      contentType: "video/mp4",
      rightsConfirmed: true,
    })
    expect(imports.list()).toMatchObject([
      { id: created.importId, state: "awaiting_upload", progress: 0 },
    ])

    const result = await imports.upload(
      created.importId,
      new Request(`http://127.0.0.1${created.uploadUrl}`, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Length": String(bytes.byteLength) },
      }),
    )

    expect(result).toMatchObject({ accepted: true, importId: created.importId })
    const summary = jobs.summarize(result.videoId)
    expect(summary).toMatchObject({
      title: "My Clip",
      sourceUrl: null,
      sourceKind: "local-file",
      state: "downloaded",
      watchable: true,
      activeMedia: { container: "mp4", width: 640, height: 360 },
    })
    expect(
      existsSync(
        path.join(
          workspace,
          "jobs",
          result.videoId,
          "source",
          "renditions",
          "imported.mp4",
        ),
      ),
    ).toBe(true)
    expect(imports.list()).toMatchObject([
      { id: created.importId, videoId: result.videoId, state: "ready", progress: 100 },
    ])
    opened.sqlite.close()
  })

  test("requires a matching content length before accepting bytes", async () => {
    const { opened, imports } = fixture()
    const created = imports.create({
      originalName: "clip.mp4",
      title: "Clip",
      sizeBytes: 10,
      contentType: "video/mp4",
      rightsConfirmed: true,
    })
    await expect(
      imports.upload(
        created.importId,
        new Request(`http://127.0.0.1${created.uploadUrl}`, {
          method: "PUT",
          body: "short",
          headers: { "Content-Length": "5" },
        }),
      ),
    ).rejects.toThrow("上傳內容大小與選取的檔案不一致")
    opened.sqlite.close()
  })
})
