import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { openAppDatabase } from "@server/db/client"
import { LocalModelOperationError } from "@server/services/local-model-service"
import { TranscriptionModelCatalogService } from "@server/services/transcription-model-catalog-service"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")
const migrations = path.join(
  repositoryRoot,
  "plugins/insu-player/skills/watch-video/assets/server/drizzle",
)
const workspaces: string[] = []

function preparedWorkspace() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-model-service-"))
  workspaces.push(workspace)
  const runtime = path.join(workspace, ".agent-tools", "insu-player")
  const models = path.join(runtime, "models")
  const whisper = path.join(runtime, ".venv", "bin", "whisper")
  mkdirSync(models, { recursive: true })
  mkdirSync(path.dirname(whisper), { recursive: true })
  writeFileSync(whisper, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
  chmodSync(whisper, 0o700)
  writeFileSync(path.join(models, "medium.pt"), "test", { mode: 0o600 })
  writeFileSync(
    path.join(models, "medium.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      modelId: "medium",
      checksum: "345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1",
      sizeBytes: 4,
      validatedAt: "2026-08-11T00:00:00.000Z",
    })}\n`,
    { mode: 0o600 },
  )
  return workspace
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe("transcription model catalog", () => {
  test("selects validated Whisper medium on first use and pins exactly one model", () => {
    const workspace = preparedWorkspace()
    const opened = openAppDatabase(path.join(workspace, "app.db"), migrations)
    try {
      const service = new TranscriptionModelCatalogService(workspace, opened.db)
      const catalog = service.catalog()
      expect(catalog.selectedModelId).toBe("local.openai-whisper.medium")
      expect(
        catalog.models.find((model) => model.id === catalog.selectedModelId),
      ).toMatchObject({
        id: "local.openai-whisper.medium",
        provider: "local",
        service: "openai-whisper",
        model: "medium",
        type: "local",
        ready: true,
        selected: true,
        requiresAudioUpload: false,
        requiresPerRunConsent: false,
      })
      expect(
        catalog.models.filter((model) => model.selected).map((model) => model.id),
      ).toEqual(["local.openai-whisper.medium"])
      expect(() => service.remove("local.openai-whisper.medium")).toThrow(
        LocalModelOperationError,
      )
    } finally {
      opened.sqlite.close()
    }
  })
})
