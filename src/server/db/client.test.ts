import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  DATABASE_APPLICATION_ID,
  openAppDatabase,
} from "@server/db/client"
import { DATA_SCHEMA_VERSION } from "@server/runtime-contract"

const schema = path.resolve(
  "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql",
)
const workspaces: string[] = []

function temporaryDatabase() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-player-db-"))
  workspaces.push(workspace)
  return path.join(workspace, "app.db")
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe("openAppDatabase clean-break contract", () => {
  test("creates and reopens only the exact current schema", () => {
    const databasePath = temporaryDatabase()
    const created = openAppDatabase(databasePath, schema)
    expect(
      created.sqlite.query<{ application_id: number }, []>("PRAGMA application_id").get(),
    ).toEqual({ application_id: DATABASE_APPLICATION_ID })
    expect(
      created.sqlite.query<{ user_version: number }, []>("PRAGMA user_version").get(),
    ).toEqual({ user_version: DATA_SCHEMA_VERSION })
    created.sqlite.close()

    const reopened = openAppDatabase(databasePath, schema)
    reopened.sqlite.close()
  })

  test("rejects a retired schema version instead of migrating it", () => {
    const databasePath = temporaryDatabase()
    const created = openAppDatabase(databasePath, schema)
    created.sqlite.exec(`PRAGMA user_version = ${DATA_SCHEMA_VERSION - 1}`)
    created.sqlite.close()

    expect(() => openAppDatabase(databasePath, schema)).toThrow(
      `app.db is not the current INSU Player schema ${DATA_SCHEMA_VERSION}`,
    )
  })

  test("rejects schema drift instead of accepting extra legacy tables", () => {
    const databasePath = temporaryDatabase()
    const created = openAppDatabase(databasePath, schema)
    created.sqlite.exec("CREATE TABLE legacy_download_batches (id TEXT PRIMARY KEY)")
    created.sqlite.close()

    expect(() => openAppDatabase(databasePath, schema)).toThrow(
      "app.db schema digest mismatch",
    )
  })
})
