import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { openAppDatabase } from "@server/db/client"
import { RuntimeService } from "@server/services/runtime-service"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")
const schema = path.join(
  repositoryRoot,
  "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql",
)
const temporaryRoots: string[] = []

function createWorkspace(pythonTargetOutsideWorkspace = false) {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-runtime-service-"))
  temporaryRoots.push(workspace)
  const runtime = path.join(workspace, ".agent-tools", "insu-player")
  const paths = [
    path.join(runtime, "bun-runtime", "bin", "bun"),
    path.join(runtime, "bin", "ffmpeg"),
    path.join(runtime, ".venv", "bin", "yt-dlp"),
    path.join(runtime, ".venv", "bin", "whisper"),
    path.join(runtime, "models", "medium.pt"),
  ]
  for (const candidate of paths) {
    mkdirSync(path.dirname(candidate), { recursive: true })
    writeFileSync(candidate, "test")
  }

  const pythonTarget = pythonTargetOutsideWorkspace
    ? path.join(mkdtempSync(path.join(tmpdir(), "insu-runtime-outside-")), "python")
    : path.join(runtime, "python", "cpython", "bin", "python3")
  if (pythonTargetOutsideWorkspace) {
    temporaryRoots.push(path.dirname(pythonTarget))
  }
  mkdirSync(path.dirname(pythonTarget), { recursive: true })
  writeFileSync(pythonTarget, "test")
  const python = path.join(runtime, ".venv", "bin", "python")
  symlinkSync(pythonTarget, python)
  return workspace
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe("runtime readiness", () => {
  test("accepts a workspace-local Python symlink", () => {
    const workspace = createWorkspace()
    const opened = openAppDatabase(path.join(workspace, "app.db"), schema)
    try {
      const status = new RuntimeService(workspace, opened.db).status()
      expect(status.initialized).toBe(true)
      expect(
        status.capabilities.find(({ key }) => key === "python"),
      ).toMatchObject({
        state: "ready",
        label: "影音處理套件",
      })
    } finally {
      opened.sqlite.close()
    }
  })

  test("rejects a Python symlink that leaves the workspace runtime", () => {
    const workspace = createWorkspace(true)
    const opened = openAppDatabase(path.join(workspace, "app.db"), schema)
    try {
      const status = new RuntimeService(workspace, opened.db).status()
      expect(status.initialized).toBe(false)
      expect(
        status.capabilities.find(({ key }) => key === "python"),
      ).toMatchObject({
        state: "missing",
      })
    } finally {
      opened.sqlite.close()
    }
  })
})
