import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import path from "node:path"

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

import * as schema from "@server/db/schema"
import { DATA_SCHEMA_VERSION } from "@server/runtime-contract"

export const DATABASE_APPLICATION_ID = 0x494e5355

interface SchemaRow {
  type: string
  name: string
  tbl_name: string
  sql: string
}

function schemaRows(sqlite: Database) {
  return sqlite
    .query<SchemaRow, []>(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all()
}

function schemaDigest(rows: SchemaRow[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

function pragmaNumber(sqlite: Database, pragma: string) {
  const row = sqlite.query<Record<string, number>, []>(`PRAGMA ${pragma}`).get()
  return row ? Number(Object.values(row)[0]) : Number.NaN
}

function assertCurrentDatabase(sqlite: Database, schemaSql: string) {
  const applicationId = pragmaNumber(sqlite, "application_id")
  const userVersion = pragmaNumber(sqlite, "user_version")
  if (
    applicationId !== DATABASE_APPLICATION_ID ||
    userVersion !== DATA_SCHEMA_VERSION
  ) {
    throw new Error(
      `app.db is not the current INSU Player schema ${DATA_SCHEMA_VERSION}; rebuild the workspace library`,
    )
  }

  const expected = new Database(":memory:")
  try {
    expected.exec("PRAGMA foreign_keys = ON")
    expected.exec(schemaSql)
    const expectedDigest = schemaDigest(schemaRows(expected))
    const actualDigest = schemaDigest(schemaRows(sqlite))
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `app.db schema digest mismatch; expected ${expectedDigest}, received ${actualDigest}; rebuild the workspace library`,
      )
    }
  } finally {
    expected.close()
  }
}

export function openAppDatabase(databasePath: string, schemaFile: string) {
  const resolvedSchema = path.resolve(schemaFile)
  if (
    !existsSync(resolvedSchema) ||
    lstatSync(resolvedSchema).isSymbolicLink() ||
    !lstatSync(resolvedSchema).isFile()
  ) {
    throw new Error("current database schema file is unavailable")
  }
  const schemaSql = readFileSync(resolvedSchema, "utf8")
  const databaseExists = existsSync(databasePath) && statSync(databasePath).size > 0

  mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = new Database(databasePath, { create: true })
  try {
    sqlite.exec("PRAGMA foreign_keys = ON")
    if (databaseExists) {
      assertCurrentDatabase(sqlite, schemaSql)
    } else {
      sqlite.exec(schemaSql)
      sqlite.exec(`PRAGMA application_id = ${DATABASE_APPLICATION_ID}`)
      sqlite.exec(`PRAGMA user_version = ${DATA_SCHEMA_VERSION}`)
      assertCurrentDatabase(sqlite, schemaSql)
    }
    sqlite.exec("PRAGMA journal_mode = WAL")
    sqlite.exec("PRAGMA synchronous = NORMAL")
    sqlite.exec("PRAGMA busy_timeout = 30000")
    const db = drizzle({ client: sqlite, schema })
    for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(candidate)) chmodSync(candidate, 0o600)
    }
    return { db, sqlite }
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export type AppDatabase = ReturnType<typeof openAppDatabase>["db"]
