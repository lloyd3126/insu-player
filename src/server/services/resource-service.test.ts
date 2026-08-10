import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { ResourceService } from "@server/services/resource-service"

const workspaces: string[] = []

function workspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "insu-resources-"))
  workspaces.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("resource service", () => {
  test("rejects prompt libraries without the current timestamp field", () => {
    const directory = workspace()
    writeFileSync(
      path.join(directory, "prompts.json"),
      `${JSON.stringify({
        version: 1,
        prompts: [
          {
            id: "old-prompt",
            title: "舊提示",
            scenario: "測試",
            prompt: "內容",
          },
        ],
      })}\n`,
    )
    expect(new ResourceService(directory).promptLibrary()).toMatchObject({
      available: false,
      prompts: [],
    })
  })

  test("accepts the exact current prompt library schema", () => {
    const directory = workspace()
    writeFileSync(
      path.join(directory, "prompts.json"),
      `${JSON.stringify({
        version: 1,
        prompts: [
          {
            id: "current-prompt",
            title: "現行提示",
            scenario: "測試",
            prompt: "內容",
            updatedAt: "2026-08-10T00:00:00.000Z",
          },
        ],
      })}\n`,
    )
    expect(new ResourceService(directory).promptLibrary()).toEqual({
      available: true,
      version: 1,
      prompts: [
        {
          id: "current-prompt",
          title: "現行提示",
          scenario: "測試",
          prompt: "內容",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    })
  })
})
