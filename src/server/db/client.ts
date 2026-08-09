import { chmodSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"

import * as schema from "@server/db/schema"

export function openAppDatabase(databasePath: string, migrationsFolder: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = new Database(databasePath, { create: true })
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA synchronous = NORMAL")
  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder })
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600)
  }
  return { db, sqlite }
}

export type AppDatabase = ReturnType<typeof openAppDatabase>["db"]
