import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { RemovalService } from "@server/services/removal-service"

const temporaryDirectories: string[] = []

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-removal-service-"))
  temporaryDirectories.push(workspace)
  mkdirSync(path.join(workspace, "jobs"), { recursive: true })
  const script = path.join(workspace, "remove.py")
  writeFileSync(script, "# test fixture\n")
  return { workspace, script }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("RemovalService workspace runtime", () => {
  test("accepts a venv Python symlink whose target stays in the workspace runtime", async () => {
    const { workspace, script } = fixture()
    const runtime = path.join(workspace, ".agent-tools", "insu-player")
    const executable = path.join(runtime, "python", "bin", "python3")
    const virtualEnvironment = path.join(runtime, ".venv", "bin")
    mkdirSync(path.dirname(executable), { recursive: true })
    mkdirSync(virtualEnvironment, { recursive: true })
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' '{"digest":"${"a".repeat(64)}","blocked":[],"warnings":[]}'\n`,
    )
    chmodSync(executable, 0o700)
    symlinkSync(executable, path.join(virtualEnvironment, "python"))

    const preview = await new RemovalService(workspace, script).preview({
      kind: "video",
      videoId: "demo-video",
    })

    expect(preview.planDigest).toBe("a".repeat(64))
    expect(preview.blocked).toEqual([])
  })

  test("passes a leading-hyphen video ID as one Python option value", async () => {
    const { workspace, script } = fixture()
    const runtime = path.join(workspace, ".agent-tools", "insu-player")
    const executable = path.join(runtime, "python", "bin", "python3")
    const virtualEnvironment = path.join(runtime, ".venv", "bin")
    mkdirSync(path.dirname(executable), { recursive: true })
    mkdirSync(virtualEnvironment, { recursive: true })
    writeFileSync(
      executable,
      `#!/bin/sh
[ "$6" = "--video-id=-leading-id" ] || exit 2
printf '%s\n' '{"digest":"${"b".repeat(64)}","blocked":[],"warnings":[]}'
`,
    )
    chmodSync(executable, 0o700)
    symlinkSync(executable, path.join(virtualEnvironment, "python"))

    const preview = await new RemovalService(workspace, script).preview({
      kind: "video",
      videoId: "-leading-id",
    })

    expect(preview.planDigest).toBe("b".repeat(64))
  })

  test("rejects a venv Python symlink whose target leaves the workspace runtime", async () => {
    const { workspace, script } = fixture()
    const virtualEnvironment = path.join(
      workspace,
      ".agent-tools",
      "insu-player",
      ".venv",
      "bin",
    )
    mkdirSync(virtualEnvironment, { recursive: true })
    symlinkSync("/bin/sh", path.join(virtualEnvironment, "python"))

    await expect(
      new RemovalService(workspace, script).preview({
        kind: "video",
        videoId: "demo-video",
      }),
    ).rejects.toMatchObject({
      code: "runtime-unavailable",
    })
  })
})
